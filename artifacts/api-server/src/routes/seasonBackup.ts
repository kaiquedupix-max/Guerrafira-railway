import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { setSeasonScoringBlocked } from "./seasonControl.js";

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

export async function ensureSeasonBackupTable(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS season_hourly_backup (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      season_number INTEGER NOT NULL DEFAULT 1,
      season_id TEXT,
      players_count INTEGER NOT NULL DEFAULT 0,
      transactions_count INTEGER NOT NULL DEFAULT 0,
      players JSONB NOT NULL DEFAULT '[]'::jsonb,
      transactions JSONB NOT NULL DEFAULT '[]'::jsonb,
      season_row JSONB,
      control_row JSONB
    )
  `);
}

async function resolveBackupSeason(requested?: number): Promise<number> {
  const explicit=Math.trunc(Number(requested)||0);
  if(explicit>0)return explicit;
  const r:any=await db.execute(sql`
    SELECT season_number FROM seasons
    ORDER BY CASE WHEN status='active' THEN 0 WHEN status='scheduled' THEN 1 ELSE 2 END,season_number DESC
    LIMIT 1
  `);
  return Math.max(1,Math.trunc(Number(r?.rows?.[0]?.season_number)||1));
}

export async function createSeasonBackup(source = "automatic", requestedSeason?: number): Promise<any> {
  if (running) return getSeasonBackupStatus();
  running = true;
  try {
    await ensureSeasonBackupTable();
    const seasonNumber=await resolveBackupSeason(requestedSeason);
    const snap: any = await db.execute(sql`
      SELECT
        COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.steam_id) FROM season_players p WHERE p.season_number=${seasonNumber}), '[]'::jsonb) AS players,
        COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.happened_at, t.transaction_id) FROM season_transactions t WHERE t.season_number=${seasonNumber}), '[]'::jsonb) AS transactions,
        (SELECT to_jsonb(s) FROM seasons s WHERE s.season_number=${seasonNumber} LIMIT 1) AS season_row,
        (SELECT to_jsonb(c) FROM season_control c WHERE c.season_number=${seasonNumber} LIMIT 1) AS control_row,
        (SELECT COUNT(*)::int FROM season_players WHERE season_number=${seasonNumber}) AS players_count,
        (SELECT COUNT(*)::int FROM season_transactions WHERE season_number=${seasonNumber}) AS transactions_count,
        (SELECT season_id FROM seasons WHERE season_number=${seasonNumber} LIMIT 1) AS season_id
    `);
    const row = snap?.rows?.[0] ?? {};
    await db.execute(sql`
      INSERT INTO season_hourly_backup (
        id, created_at, season_number, season_id, players_count, transactions_count,
        players, transactions, season_row, control_row
      ) VALUES (
        1, now(), ${seasonNumber}, ${row.season_id ?? null}, ${Number(row.players_count || 0)}, ${Number(row.transactions_count || 0)},
        ${JSON.stringify(row.players || [])}::jsonb, ${JSON.stringify(row.transactions || [])}::jsonb,
        ${row.season_row ? JSON.stringify(row.season_row) : null}::jsonb,
        ${row.control_row ? JSON.stringify(row.control_row) : null}::jsonb
      )
      ON CONFLICT (id) DO UPDATE SET
        created_at=now(), season_number=EXCLUDED.season_number, season_id=EXCLUDED.season_id,
        players_count=EXCLUDED.players_count, transactions_count=EXCLUDED.transactions_count,
        players=EXCLUDED.players, transactions=EXCLUDED.transactions,
        season_row=EXCLUDED.season_row, control_row=EXCLUDED.control_row
    `);
    logger.info({ source, seasonNumber, players: Number(row.players_count || 0), transactions: Number(row.transactions_count || 0) }, "Season hourly backup replaced");
    return getSeasonBackupStatus();
  } finally {
    running = false;
  }
}

export async function getSeasonBackupStatus(): Promise<any> {
  await ensureSeasonBackupTable();
  const r: any = await db.execute(sql`
    SELECT id, created_at, season_number, season_id, players_count, transactions_count
    FROM season_hourly_backup WHERE id=1 LIMIT 1
  `);
  return r?.rows?.[0] ?? null;
}

export async function restoreSeasonBackup(admin: string, expectedSeason?: number): Promise<any> {
  await ensureSeasonBackupTable();
  const r: any = await db.execute(sql`SELECT * FROM season_hourly_backup WHERE id=1 LIMIT 1`);
  const backup = r?.rows?.[0];
  if (!backup) throw new Error("Nenhum backup da Season está disponível.");
  const seasonNumber=Math.max(1,Math.trunc(Number(backup.season_number)||1));
  const expected=Math.trunc(Number(expectedSeason)||0);
  if(expected>0&&seasonNumber!==expected)throw new Error(`O backup disponível pertence à Season ${seasonNumber}, não à Season ${expected}. Crie um backup da Season atual antes de restaurar.`);

  await setSeasonScoringBlocked(seasonNumber, true, admin);
  const playersJson = JSON.stringify(backup.players || []);
  const transactionsJson = JSON.stringify(backup.transactions || []);
  const seasonJson = backup.season_row ? JSON.stringify(backup.season_row) : null;
  const controlJson = backup.control_row ? JSON.stringify(backup.control_row) : null;

  await db.transaction(async tx => {
    await tx.execute(sql`DELETE FROM season_transactions WHERE season_number=${seasonNumber}`);
    await tx.execute(sql`DELETE FROM season_players WHERE season_number=${seasonNumber}`);
    await tx.execute(sql`DELETE FROM seasons WHERE season_number=${seasonNumber}`);
    if (seasonJson) await tx.execute(sql`INSERT INTO seasons SELECT * FROM jsonb_populate_record(NULL::seasons, ${seasonJson}::jsonb)`);
    if (playersJson !== "[]") await tx.execute(sql`INSERT INTO season_players SELECT * FROM jsonb_populate_recordset(NULL::season_players, ${playersJson}::jsonb)`);
    if (transactionsJson !== "[]") await tx.execute(sql`INSERT INTO season_transactions SELECT * FROM jsonb_populate_recordset(NULL::season_transactions, ${transactionsJson}::jsonb)`);
    if (controlJson) {
      await tx.execute(sql`DELETE FROM season_control WHERE season_number=${seasonNumber}`);
      await tx.execute(sql`INSERT INTO season_control SELECT * FROM jsonb_populate_record(NULL::season_control, ${controlJson}::jsonb)`);
    }
  });

  await setSeasonScoringBlocked(seasonNumber, true, admin);
  const verify: any = await db.execute(sql`
    SELECT
      (SELECT COUNT(*)::int FROM season_players WHERE season_number=${seasonNumber}) AS players,
      (SELECT COUNT(*)::int FROM season_transactions WHERE season_number=${seasonNumber}) AS transactions,
      (SELECT season_id FROM seasons WHERE season_number=${seasonNumber} LIMIT 1) AS season_id
  `);
  const v = verify?.rows?.[0] ?? {};
  if (Number(v.players) !== Number(backup.players_count) || Number(v.transactions) !== Number(backup.transactions_count)) {
    throw new Error(`Restauração não passou na verificação: ${v.players}/${backup.players_count} jogadores e ${v.transactions}/${backup.transactions_count} transações.`);
  }
  logger.warn({ admin, seasonNumber, backupAt: backup.created_at, players: v.players, transactions: v.transactions }, "Season backup restored");
  return { seasonNumber, backupAt: backup.created_at, seasonId: v.season_id, players: Number(v.players), transactions: Number(v.transactions) };
}

export function startSeasonHourlyBackup(): void {
  if (timer) clearInterval(timer);
  const run = () => createSeasonBackup("automatic").catch(error => logger.error({ error }, "Season hourly backup failed"));
  setTimeout(run, 30_000);
  timer = setInterval(run, 60 * 60_000);
  logger.info("Season hourly single-slot backup scheduler started");
}

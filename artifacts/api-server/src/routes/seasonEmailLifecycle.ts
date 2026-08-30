import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import {
  SEASON_END_AT,
  SEASON_OFFICIAL_KEY,
  SEASON_START_AT,
  ensureSeasonEmailInfrastructure,
  getOfficialSeasonRegistrations,
  seasonEmailMode,
  sendSeasonEmail,
  type SeasonWinner,
} from "./seasonEmailService.js";

let lifecycleStarted = false;
let lifecycleRunning = false;

async function officialCount() {
  const r: any = await db.execute(sql`SELECT COUNT(*)::int total FROM season_official_registrations WHERE season_key=${SEASON_OFFICIAL_KEY} AND status='active'`);
  return Number(r?.rows?.[0]?.total || 0);
}

export async function getSeasonFinalWinners(): Promise<SeasonWinner[]> {
  const total = await officialCount();
  const pool = Math.max(300, total * 20);
  const source: any = await db.execute(sql`SELECT season_number FROM season_players GROUP BY season_number ORDER BY MAX(updated_at) DESC NULLS LAST,season_number DESC LIMIT 1`);
  const seasonNumber = Number(source?.rows?.[0]?.season_number || 1);
  const r: any = await db.execute(sql`
    WITH admin_delta AS (
      SELECT steam_id,COALESCE(SUM(final_value),0) delta
      FROM season_transactions
      WHERE season_number=${seasonNumber} AND category='admin'
      GROUP BY steam_id
    )
    SELECT o.discord_name,o.steam_id,COALESCE(p.player_name,o.discord_name) player_name,
      ROUND(GREATEST(0,((COALESCE(p.mmr,1000)+COALESCE(a.delta,0))-1000)*9))::int xp
    FROM season_official_registrations o
    LEFT JOIN season_players p ON p.season_number=${seasonNumber} AND p.steam_id=o.steam_id
    LEFT JOIN admin_delta a ON a.steam_id=o.steam_id
    WHERE o.season_key=${SEASON_OFFICIAL_KEY} AND o.status='active'
    ORDER BY (COALESCE(p.mmr,1000)+COALESCE(a.delta,0)) DESC,COALESCE(p.kills,0) DESC,o.paid_at ASC NULLS LAST
    LIMIT 3
  `);
  const rows = Array.isArray(r?.rows) ? r.rows : [];
  return rows.map((x: any, i: number) => ({
    position: i + 1,
    name: String(x.player_name || x.discord_name || "Jogador"),
    discordName: String(x.discord_name || ""),
    steamId: String(x.steam_id || ""),
    xp: Number(x.xp || 0),
    prize: i === 0 ? `R$ ${(pool * .50).toFixed(2).replace('.', ',')}` : i === 1 ? `R$ ${(pool * .30).toFixed(2).replace('.', ',')}` : "VIP Ouro • 30 dias",
  }));
}

async function markerDone(key: string) {
  const r: any = await db.execute(sql`SELECT marker_key FROM season_email_lifecycle WHERE marker_key=${key} LIMIT 1`);
  return Boolean(r?.rows?.[0]);
}

async function markDone(key: string, details: string) {
  await db.execute(sql`INSERT INTO season_email_lifecycle(marker_key,details) VALUES(${key},${details}) ON CONFLICT(marker_key) DO UPDATE SET completed_at=now(),details=EXCLUDED.details`);
}

export async function dispatchSeasonLifecycleEmail(template: "start" | "end", adminName = "Sistema automático", force = false) {
  await ensureSeasonEmailInfrastructure();
  const mode = seasonEmailMode();
  const marker = `season1-${template}-${mode}`;
  if (!force && await markerDone(marker)) return { ok: true, skipped: true, sent: 0, simulated: 0, failed: 0 };
  const registrations = await getOfficialSeasonRegistrations();
  const winners = template === "end" ? await getSeasonFinalWinners() : [];
  let sent = 0, simulated = 0, skipped = 0, failed = 0;
  for (const row of registrations) {
    try {
      const result = await sendSeasonEmail({ row, template, winners, adminName, force });
      if (result.status === "sent") sent++;
      else if (result.status === "simulated") simulated++;
      else skipped++;
    } catch (error) {
      failed++;
      logger.error({ error, discordId: row.discord_id, template }, "Season lifecycle email failed");
    }
  }
  if (!failed) await markDone(marker, `${template}: ${sent} enviados, ${simulated} simulados, ${skipped} já processados; total ${registrations.length}`);
  return { ok: failed === 0, sent, simulated, skipped, failed, total: registrations.length, winners };
}

export async function runSeasonEmailLifecycleNow() {
  if (lifecycleRunning) return;
  lifecycleRunning = true;
  try {
    const now = Date.now();
    if (now >= SEASON_START_AT) await dispatchSeasonLifecycleEmail("start");
    if (now >= SEASON_END_AT) await dispatchSeasonLifecycleEmail("end");
  } catch (error) {
    logger.error({ error }, "Season email lifecycle check failed");
  } finally {
    lifecycleRunning = false;
  }
}

export function startSeasonEmailLifecycle() {
  if (lifecycleStarted) return;
  lifecycleStarted = true;
  setTimeout(() => void runSeasonEmailLifecycleNow(), 8_000).unref?.();
  const interval = setInterval(() => void runSeasonEmailLifecycleNow(), 5 * 60_000);
  interval.unref?.();
  const schedule = (at: number) => {
    const delay = at - Date.now();
    if (delay > 0 && delay <= 2_147_000_000) setTimeout(() => void runSeasonEmailLifecycleNow(), delay + 1_500).unref?.();
  };
  schedule(SEASON_START_AT);
  schedule(SEASON_END_AT);
  logger.info({ mode: seasonEmailMode() }, "Season email lifecycle initialized");
}

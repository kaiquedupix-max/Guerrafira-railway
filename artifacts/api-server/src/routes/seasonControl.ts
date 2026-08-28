import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { executeRconCommand } from "../bot/utils/rcon.js";
import { logger } from "../lib/logger.js";

const BETA_START = Date.parse("2026-08-28T18:30:00-03:00");
const LEGACY_BETA_KEY = "season-beta-2026-08-28";
const PREP_KEY = "season-beta-prepared-2026-08-28";
const START_KEY = "season-beta-scoring-started-2026-08-28";
let betaTimerStarted = false;

export async function ensureSeasonControl() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS season_control (
      season_number INTEGER PRIMARY KEY,
      scoring_blocked BOOLEAN NOT NULL DEFAULT TRUE,
      changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      changed_by TEXT,
      last_reset_at TIMESTAMPTZ,
      last_reset_by TEXT
    )
  `);
  await db.execute(sql`
    INSERT INTO season_control (season_number, scoring_blocked)
    VALUES (1, TRUE)
    ON CONFLICT (season_number) DO NOTHING
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS season_beta_control (
      beta_key TEXT PRIMARY KEY,
      completed_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`ALTER TABLE season_beta_control ADD COLUMN IF NOT EXISTS details TEXT`);
}

export async function getSeasonControl(seasonNumber = 1) {
  await ensureSeasonControl();
  const r: any = await db.execute(sql`
    SELECT season_number, scoring_blocked, changed_at, changed_by, last_reset_at, last_reset_by
    FROM season_control WHERE season_number=${seasonNumber} LIMIT 1
  `);
  return r?.rows?.[0] ?? { season_number: seasonNumber, scoring_blocked: true };
}

export async function setSeasonScoringBlocked(seasonNumber: number, blocked: boolean, admin: string) {
  await ensureSeasonControl();
  await db.execute(sql`
    INSERT INTO season_control (season_number, scoring_blocked, changed_at, changed_by)
    VALUES (${seasonNumber}, ${blocked}, now(), ${admin})
    ON CONFLICT (season_number) DO UPDATE SET
      scoring_blocked=EXCLUDED.scoring_blocked,
      changed_at=now(), changed_by=EXCLUDED.changed_by
  `);
}

export async function markSeasonReset(seasonNumber: number, admin: string) {
  await ensureSeasonControl();
  await db.execute(sql`
    UPDATE season_control SET last_reset_at=now(), last_reset_by=${admin}, changed_at=now(), changed_by=${admin}
    WHERE season_number=${seasonNumber}
  `);
}

async function hasMarker(key: string) {
  await ensureSeasonControl();
  const r: any = await db.execute(sql`SELECT beta_key FROM season_beta_control WHERE beta_key=${key} LIMIT 1`);
  return Boolean(r?.rows?.[0]);
}

async function prepareBetaBeforeStart() {
  if (Date.now() >= BETA_START || await hasMarker(PREP_KEY)) return;
  await db.transaction(async tx => {
    await tx.execute(sql`DELETE FROM season_transactions WHERE season_number=1`);
    await tx.execute(sql`DELETE FROM season_players WHERE season_number=1`);
    await tx.execute(sql`
      INSERT INTO season_control (season_number, scoring_blocked, changed_at, changed_by, last_reset_at, last_reset_by)
      VALUES (1, TRUE, now(), 'Beta automático 28/08', now(), 'Beta automático 28/08')
      ON CONFLICT (season_number) DO UPDATE SET
        scoring_blocked=TRUE, changed_at=now(), changed_by='Beta automático 28/08',
        last_reset_at=now(), last_reset_by='Beta automático 28/08'
    `);
    await tx.execute(sql`
      INSERT INTO season_beta_control (beta_key, details)
      VALUES (${PREP_KEY}, 'Pontuação anterior apagada e coleta bloqueada até 18:30 BRT.')
      ON CONFLICT (beta_key) DO NOTHING
    `);
    // Neutraliza o controller legado, que apagava inscrições no horário de início.
    await tx.execute(sql`
      INSERT INTO season_beta_control (beta_key, details)
      VALUES (${LEGACY_BETA_KEY}, 'Controller legado neutralizado; início controlado por seasonControl.')
      ON CONFLICT (beta_key) DO NOTHING
    `);
  });
  logger.info("[SEASON BETA] pontuação zerada; coleta bloqueada até 18:30 BRT");
}

async function startBetaScoring() {
  try {
    if (await hasMarker(START_KEY)) return;
    await setSeasonScoringBlocked(1, true, "Beta automático 28/08");

    const reply = await executeRconCommand("season.forcenew beta-2026-08-28");
    if (reply == null) {
      logger.error("[SEASON BETA] RCON não confirmou season.forcenew; coleta continua bloqueada e haverá retry em 60s");
      setTimeout(() => void startBetaScoring(), 60_000);
      return;
    }

    await db.transaction(async tx => {
      await tx.execute(sql`DELETE FROM season_transactions WHERE season_number=1`);
      await tx.execute(sql`DELETE FROM season_players WHERE season_number=1`);
      await tx.execute(sql`
        INSERT INTO seasons (season_number, season_id, status, starting_mmr, started_at, ended_at, updated_at)
        VALUES (1, 'beta-2026-08-28', 'active', 1000, now(), NULL, now())
        ON CONFLICT (season_number) DO UPDATE SET
          season_id='beta-2026-08-28', status='active', starting_mmr=1000,
          started_at=now(), ended_at=NULL, updated_at=now()
      `);
      await tx.execute(sql`
        INSERT INTO season_beta_control (beta_key, details)
        VALUES (${START_KEY}, 'Beta iniciada às 18:30 BRT; plugin e banco zerados; coleta liberada.')
        ON CONFLICT (beta_key) DO NOTHING
      `);
    });

    await setSeasonScoringBlocked(1, false, "Início automático Beta 18:30");
    logger.info({ reply }, "[SEASON BETA] 18:30 BRT: reset final concluído e pontuação liberada");
  } catch (error) {
    logger.error({ error }, "[SEASON BETA] falha ao iniciar pontuação; coleta permanece bloqueada e haverá retry em 60s");
    try { await setSeasonScoringBlocked(1, true, "Falha no início automático Beta"); } catch {}
    setTimeout(() => void startBetaScoring(), 60_000);
  }
}

async function bootstrapBetaWindow() {
  if (betaTimerStarted) return;
  betaTimerStarted = true;
  try {
    await prepareBetaBeforeStart();
  } catch (error) {
    logger.error({ error }, "[SEASON BETA] falha ao preparar reset; retry em 30s");
    betaTimerStarted = false;
    setTimeout(() => void bootstrapBetaWindow(), 30_000);
    return;
  }

  const delay = BETA_START - Date.now();
  if (delay <= 0) void startBetaScoring();
  else {
    logger.info({ startsAt: "28/08/2026 18:30 BRT", delayMs: delay }, "[SEASON BETA] início automático agendado");
    setTimeout(() => void startBetaScoring(), delay);
  }
}

void bootstrapBetaWindow();

const router: IRouter = Router();
router.use(async (req, res, next) => {
  if (req.path !== "/season/events" && req.path !== "/season/snapshot") return next();
  try {
    const control = await getSeasonControl(1);
    if (Boolean(control.scoring_blocked)) {
      res.setHeader("Cache-Control", "no-store");
      return void res.status(202).json({ ok: true, blocked: true, accepted: 0, saved: 0, message: "Pontuação da Season está BLOQUEADA. Beta libera automaticamente às 18:30 BRT." });
    }
    return next();
  } catch {
    return void res.status(503).json({ ok: false, error: "Não foi possível validar o estado da pontuação da Season." });
  }
});

export default router;

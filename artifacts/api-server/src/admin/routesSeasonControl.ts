import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAdmin } from "./guard.js";
import { getAdminSessionV3 } from "./sessionBearer.js";
import { executeRconCommand } from "../bot/utils/rcon.js";
import { getSeasonControl, markSeasonReset, setSeasonScoringBlocked } from "../routes/seasonControl.js";

const router = Router();
router.use(requireAdmin);

const adminName = (req: any) => getAdminSessionV3(req)?.username || "Administrador";

async function logAction(admin: string, action: string, details: string) {
  await db.execute(sql`CREATE TABLE IF NOT EXISTS season_admin_actions (
    id BIGSERIAL PRIMARY KEY,season_key INTEGER NOT NULL,admin_name TEXT NOT NULL,action TEXT NOT NULL,discord_id TEXT,details TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  await db.execute(sql`INSERT INTO season_admin_actions(season_key,admin_name,action,details) VALUES(1,${admin},${action},${details})`);
}

router.get("/control", async (_req, res) => {
  try {
    const control: any = await getSeasonControl(1);
    res.setHeader("Cache-Control", "no-store");
    return void res.json({
      ok: true,
      season: 1,
      scoringBlocked: Boolean(control.scoring_blocked),
      changedAt: control.changed_at || null,
      changedBy: control.changed_by || null,
      lastResetAt: control.last_reset_at || null,
      lastResetBy: control.last_reset_by || null,
    });
  } catch {
    return void res.status(500).json({ ok: false, error: "Falha ao carregar controle da Season 1." });
  }
});

router.post("/control/block", async (req, res) => {
  try {
    const admin = adminName(req);
    await setSeasonScoringBlocked(1, true, admin);
    await logAction(admin, "scoring_blocked", "Pontuação da Season 1 bloqueada manualmente.");
    return void res.json({ ok: true, scoringBlocked: true, message: "Pontuação da Season 1 bloqueada. Eventos e snapshots não serão gravados." });
  } catch {
    return void res.status(500).json({ ok: false, error: "Falha ao bloquear pontuação da Season 1." });
  }
});

router.post("/control/start", async (req, res) => {
  try {
    const admin = adminName(req);
    await setSeasonScoringBlocked(1, false, admin);
    await logAction(admin, "scoring_started", "Pontuação da Season 1 liberada manualmente.");
    return void res.json({ ok: true, scoringBlocked: false, message: "Pontuação da Season 1 liberada imediatamente." });
  } catch {
    return void res.status(500).json({ ok: false, error: "Falha ao iniciar pontuação da Season 1." });
  }
});

router.post("/control/reset", async (req, res) => {
  const confirm = String(req.body?.confirm || "").trim().toUpperCase();
  if (confirm !== "ZERAR") return void res.status(400).json({ ok: false, error: "Confirmação inválida. Digite ZERAR." });
  const admin = adminName(req);
  try {
    await setSeasonScoringBlocked(1, true, admin);
    const seasonId = `season-1-reset-${Date.now()}`;
    const rcon = await executeRconCommand(`season.forcenew ${seasonId}`);
    if (rcon == null) {
      return void res.status(503).json({ ok: false, scoringBlocked: true, error: "RCON não confirmou o reset do plugin. O banco NÃO foi zerado e a pontuação permaneceu bloqueada." });
    }

    await db.transaction(async tx => {
      await tx.execute(sql`DELETE FROM season_transactions WHERE season_number=1`);
      await tx.execute(sql`DELETE FROM season_players WHERE season_number=1`);
      await tx.execute(sql`
        INSERT INTO seasons (season_number, season_id, status, starting_mmr, started_at, ended_at, updated_at)
        VALUES (1, ${seasonId}, 'active', 1000, now(), NULL, now())
        ON CONFLICT (season_number) DO UPDATE SET season_id=EXCLUDED.season_id,status='active',starting_mmr=1000,started_at=now(),ended_at=NULL,updated_at=now()
      `);
    });
    await markSeasonReset(1, admin);
    await logAction(admin, "season_score_reset", `Pontuação e histórico de MMR da Season 1 zerados; inscrições oficiais preservadas; id ${seasonId}.`);
    return void res.json({ ok: true, scoringBlocked: true, seasonId, message: "Pontuação da Season 1 zerada. As inscrições foram preservadas e a pontuação continua BLOQUEADA até clicar em INICIAR PONTUAÇÃO." });
  } catch (error) {
    req.log?.error?.({ error }, "season 1 manual reset failed");
    return void res.status(500).json({ ok: false, scoringBlocked: true, error: "Falha ao zerar a Season 1. A pontuação permaneceu bloqueada por segurança." });
  }
});

export default router;

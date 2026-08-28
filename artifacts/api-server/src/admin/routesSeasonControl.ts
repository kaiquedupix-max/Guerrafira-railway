import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAdmin } from "./guard.js";
import { getAdminSessionV3 } from "./sessionBearer.js";
import { executeRconCommand } from "../bot/utils/rcon.js";
import { getSeasonControl, markSeasonReset, setSeasonScoringBlocked } from "../routes/seasonControl.js";

const router = Router();
router.use(requireAdmin);
const BETA_KEY = "season-beta-2026-08-28";

const adminName = (req: any) => getAdminSessionV3(req)?.username || "Administrador";

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
  } catch (error) {
    return void res.status(500).json({ ok: false, error: "Falha ao carregar controle da Season." });
  }
});

router.post("/control/block", async (req, res) => {
  try {
    const admin = adminName(req);
    await setSeasonScoringBlocked(1, true, admin);
    return void res.json({ ok: true, scoringBlocked: true, message: "Pontuação bloqueada. Eventos e snapshots não serão gravados." });
  } catch (error) {
    return void res.status(500).json({ ok: false, error: "Falha ao bloquear pontuação." });
  }
});

router.post("/control/start", async (req, res) => {
  try {
    const admin = adminName(req);
    await setSeasonScoringBlocked(1, false, admin);
    await db.execute(sql`CREATE TABLE IF NOT EXISTS season_beta_control (control_key TEXT PRIMARY KEY, completed_at TIMESTAMPTZ NOT NULL DEFAULT now(), details TEXT)`);
    await db.execute(sql`
      INSERT INTO season_beta_control (control_key, completed_at, details)
      VALUES (${BETA_KEY}, now(), ${`Início manual da pontuação por ${admin}.`})
      ON CONFLICT (control_key) DO UPDATE SET completed_at=now(), details=EXCLUDED.details
    `);
    return void res.json({ ok: true, scoringBlocked: false, message: "Pontuação liberada imediatamente." });
  } catch (error) {
    return void res.status(500).json({ ok: false, error: "Falha ao iniciar pontuação." });
  }
});

router.post("/control/reset", async (req, res) => {
  const confirm = String(req.body?.confirm || "").trim().toUpperCase();
  if (confirm !== "ZERAR") return void res.status(400).json({ ok: false, error: "Confirmação inválida. Digite ZERAR." });
  const admin = adminName(req);
  try {
    // Bloqueia primeiro para impedir gravações durante o reset.
    await setSeasonScoringBlocked(1, true, admin);
    const seasonId = `beta-manual-${Date.now()}`;
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
    await db.execute(sql`CREATE TABLE IF NOT EXISTS season_beta_control (control_key TEXT PRIMARY KEY, completed_at TIMESTAMPTZ NOT NULL DEFAULT now(), details TEXT)`);
    await db.execute(sql`
      INSERT INTO season_beta_control (control_key, completed_at, details)
      VALUES (${BETA_KEY}, now(), ${`Reset manual concluído por ${admin}; ${seasonId}.`})
      ON CONFLICT (control_key) DO UPDATE SET completed_at=now(), details=EXCLUDED.details
    `);
    return void res.json({ ok: true, scoringBlocked: true, seasonId, message: "Season zerada. Inscrições foram preservadas e a pontuação continua BLOQUEADA até clicar em INICIAR PONTUAÇÃO." });
  } catch (error) {
    req.log?.error?.({ error }, "season manual reset failed");
    return void res.status(500).json({ ok: false, scoringBlocked: true, error: "Falha ao zerar Season. A pontuação permaneceu bloqueada por segurança." });
  }
});

export default router;

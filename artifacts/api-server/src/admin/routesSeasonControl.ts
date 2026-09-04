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
  const seasonId = `season-1-reset-${Date.now()}`;

  try {
    // Fecha primeiro toda entrada de pontuação. O reset não depende do RCON.
    await setSeasonScoringBlocked(1, true, admin);

    // O reset da Season oficial precisa remover TODA fonte antiga de pontuação,
    // inclusive seasons beta/legadas. Inscrições e pagamentos ficam em tabelas
    // próprias e são preservados.
    await db.transaction(async tx => {
      await tx.execute(sql`DELETE FROM season_transactions`);
      await tx.execute(sql`DELETE FROM season_players`);
      await tx.execute(sql`DELETE FROM seasons`);
      await tx.execute(sql`
        INSERT INTO seasons (season_number, season_id, status, starting_mmr, started_at, ended_at, updated_at)
        VALUES (1, ${seasonId}, 'active', 1000, now(), NULL, now())
      `);
    });

    // Só responde sucesso se não existir nenhum dado de pontuação legado e a
    // Season 1 recém-criada for exatamente a atual.
    const verification: any = await db.execute(sql`
      SELECT
        (SELECT COUNT(*)::int FROM season_players) AS players,
        (SELECT COUNT(*)::int FROM season_transactions) AS transactions,
        (SELECT COUNT(*)::int FROM seasons WHERE season_number<>1) AS legacy_seasons,
        (SELECT season_id FROM seasons WHERE season_number=1 LIMIT 1) AS season_id
    `);
    const playersRemaining = Number(verification?.rows?.[0]?.players ?? -1);
    const transactionsRemaining = Number(verification?.rows?.[0]?.transactions ?? -1);
    const legacySeasonsRemaining = Number(verification?.rows?.[0]?.legacy_seasons ?? -1);
    const verifiedSeasonId = String(verification?.rows?.[0]?.season_id || "");
    if (playersRemaining !== 0 || transactionsRemaining !== 0 || legacySeasonsRemaining !== 0 || verifiedSeasonId !== seasonId) {
      throw new Error(`Verificação do reset falhou: ${playersRemaining} jogadores / ${transactionsRemaining} transações / ${legacySeasonsRemaining} seasons antigas.`);
    }

    await markSeasonReset(1, admin).catch(error => {
      req.log?.warn?.({ error }, "season reset marker failed after successful database reset");
    });
    await logAction(
      admin,
      "season_score_reset",
      `Toda pontuação, histórico e seasons antigas foram zerados; inscrições oficiais preservadas; id ${seasonId}.`,
    ).catch(error => {
      req.log?.warn?.({ error }, "season reset audit log failed after successful database reset");
    });

    // Tenta alinhar o estado local do plugin. Mesmo que falhe, o banco já está
    // zerado e continua bloqueado, portanto nenhum backup antigo pode repopular.
    let pluginResetConfirmed = false;
    let rconWarning: string | null = null;
    try {
      const rcon = await executeRconCommand(`season.forcenew ${seasonId}`);
      pluginResetConfirmed = rcon != null;
      if (!pluginResetConfirmed) rconWarning = "RCON não confirmou o reset do plugin.";
    } catch (error) {
      rconWarning = error instanceof Error ? error.message : "RCON não confirmou o reset do plugin.";
      req.log?.warn?.({ error }, "season plugin reset failed after successful database reset");
    }

    const message = pluginResetConfirmed
      ? "Season 1 zerada: pontuação e histórico estão em 0, dados antigos foram removidos e inscrições foram preservadas. A pontuação ficou BLOQUEADA até clicar em INICIAR PONTUAÇÃO."
      : "Season 1 zerada no banco e verificada em 0. Dados antigos foram removidos; inscrições foram preservadas. Como o RCON não confirmou o plugin, a pontuação ficou BLOQUEADA por segurança.";

    res.setHeader("Cache-Control", "no-store");
    return void res.json({
      ok: true,
      scoringBlocked: true,
      seasonId,
      pluginResetConfirmed,
      rconWarning,
      playersRemaining,
      transactionsRemaining,
      legacySeasonsRemaining,
      message,
    });
  } catch (error) {
    req.log?.error?.({ error }, "season 1 manual reset failed");
    return void res.status(500).json({
      ok: false,
      scoringBlocked: true,
      error: error instanceof Error
        ? `Falha ao zerar a Season 1: ${error.message}`
        : "Falha ao zerar a Season 1. A pontuação permaneceu bloqueada por segurança.",
    });
  }
});

export default router;

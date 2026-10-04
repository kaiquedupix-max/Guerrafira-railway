import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import crypto from "node:crypto";
import { banPlayer, verifyPlayer } from "../core/systemActions.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();
const STEAM_ID_RE = /^7656119\d{10}$/;

function safe(value: unknown, max = 500): string {
  return String(value ?? "")
    .replace(/[\r\n\t]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function safeRustChat(value: unknown, max = 80): string {
  return String(value ?? "")
    .replace(/[<>;"'\\\r\n\t]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function integrationKey(): string {
  return String(process.env.VORKEN_GF_INTEGRATION_KEY || "").trim();
}

function secretMatches(req: Request): boolean {
  const configured = integrationKey();
  const supplied = String(req.get("x-vorken-integration-key") || "").trim();

  if (!configured || !supplied) return false;

  const left = Buffer.from(configured);
  const right = Buffer.from(supplied);

  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function requireVorken(req: Request, res: Response, next: NextFunction): void {
  if (!integrationKey()) {
    res.status(503).json({
      error: "integration_not_configured",
      message: "VORKEN_GF_INTEGRATION_KEY não configurada.",
    });
    return;
  }

  if (!secretMatches(req)) {
    res.status(401).json({ error: "invalid_integration_key" });
    return;
  }

  next();
}

function safeEvidenceUrl(value: unknown): string {
  try {
    const url = new URL(String(value || "").trim());
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

// Compatibilidade com o Vorken: o progresso e toda a experiência de ticket
// agora pertencem ao próprio Vorken. O Guerra Fria apenas confirma o webhook.
router.post("/integrations/vorken/progress", requireVorken, async (req, res) => {
  const analysisId = Number(req.body?.analysisId);
  const stage = safe(req.body?.stage, 40).toLowerCase();

  if (!Number.isInteger(analysisId) || analysisId <= 0) {
    res.status(400).json({ error: "invalid_analysis_id" });
    return;
  }

  if (!["started", "processing", "completed"].includes(stage)) {
    res.status(400).json({ error: "invalid_progress_stage" });
    return;
  }

  res.json({ ok: true });
});

// O webhook é a única ponte de decisão entre o Vorken e o Guerra Fria.
// Não existe mais /telagem, validação de código ou gerenciamento de ticket aqui.
router.post("/integrations/vorken/decision", requireVorken, async (req, res) => {
  const steamId = safe(req.body?.steamId, 32);
  const playerName = safeRustChat(req.body?.playerName, 80) || steamId;
  const decision = safe(req.body?.decision, 20).toLowerCase() as "approve" | "deny";
  const reason = safe(req.body?.reason, 500) ||
    (decision === "deny"
      ? "Resultado da verificação reprovado."
      : "Resultado da verificação aprovado.");
  const discordUserId = safe(req.body?.discordUserId, 32);
  const analysisId = Number(req.body?.analysisId);
  const evidenceUrl = safeEvidenceUrl(req.body?.evidenceUrl);
  const automatic = req.body?.automatic === true;

  if (!STEAM_ID_RE.test(steamId)) {
    res.status(400).json({ error: "invalid_steam_id" });
    return;
  }

  if (decision !== "approve" && decision !== "deny") {
    res.status(400).json({ error: "invalid_decision" });
    return;
  }

  if (!Number.isInteger(analysisId) || analysisId <= 0) {
    res.status(400).json({ error: "invalid_analysis_id" });
    return;
  }

  try {
    if (decision === "approve") {
      if (!/^\d{16,20}$/.test(discordUserId)) {
        res.status(400).json({
          error: "invalid_discord_user_id",
          message: "A aprovação Vorken precisa do membro do Discord para aplicar o cargo Verificado.",
        });
        return;
      }

      const verification = await verifyPlayer({
        steamId,
        discordUserId,
        actor: {
          id: automatic ? "VORKEN_AUTO" : "VORKEN",
          name: automatic ? "Vorken Automático" : "Vorken",
          source: "system",
        },
      });

      res.json({
        ok: true,
        result: `${verification.playerName} foi verificado no Rust e no Discord.`,
        verified: true,
        automatic,
        roleAssigned: verification.roleAssigned,
      });
      return;
    }

    const punishment = await banPlayer({
      steamId,
      duration: "perm",
      reason,
      actor: {
        id: "VORKEN",
        name: "Vorken",
        source: "system",
      },
      evidenceUrl: evidenceUrl || undefined,
    });

    res.json({
      ok: true,
      result: `Banimento permanente aplicado a ${punishment.playerName || playerName}.`,
    });
  } catch (error) {
    logger.error(
      { error, steamId, decision, analysisId },
      "Vorken webhook decision failed",
    );

    res.status(500).json({
      error: "vorken_decision_failed",
      message: error instanceof Error ? error.message : "Falha ao aplicar a decisão.",
    });
  }
});

export default router;

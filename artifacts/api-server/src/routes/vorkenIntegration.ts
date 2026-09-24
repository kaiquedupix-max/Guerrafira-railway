import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import crypto from "node:crypto";
import { banPlayer, executeRconRequired } from "../core/systemActions.js";
import { discordClient } from "../bot/client.js";
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

async function notifyTicket(args: {
  channelId?: string;
  discordUserId?: string;
  steamId: string;
  decision: "approve" | "deny";
  reason: string;
  result: string;
}): Promise<void> {
  const client = discordClient();
  const channelId = safe(args.channelId, 32);

  if (!client || !/^\d{16,20}$/.test(channelId)) return;

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isSendable()) return;

  const mention = /^\d{16,20}$/.test(String(args.discordUserId || ""))
    ? `<@${args.discordUserId}>`
    : "";

  const message =
    args.decision === "deny"
      ? `🔨 **Verificação concluída: jogador punido**\nSteamID: \`${args.steamId}\`\nMotivo: **${args.reason}**\n${args.result}`
      : `✅ **Verificação concluída: jogador liberado**\nSteamID: \`${args.steamId}\`\nA sessão de verificação no servidor foi encerrada.`;

  await channel.send({
    content: `${mention ? mention + "\n" : ""}${message}`,
    allowedMentions: mention
      ? { users: [String(args.discordUserId)] }
      : { parse: [] },
  }).catch(() => {});
}

router.post("/integrations/vorken/decision", requireVorken, async (req, res) => {
  const steamId = safe(req.body?.steamId, 32);
  const decision = safe(req.body?.decision, 20).toLowerCase() as "approve" | "deny";
  const reason =
    safe(req.body?.reason, 500) ||
    (decision === "deny"
      ? "Resultado da verificação reprovado."
      : "Resultado da verificação aprovado.");
  const discordUserId = safe(req.body?.discordUserId, 32);
  const ticketChannelId = safe(req.body?.ticketChannelId, 32);

  if (!STEAM_ID_RE.test(steamId)) {
    res.status(400).json({ error: "invalid_steam_id" });
    return;
  }

  if (decision !== "approve" && decision !== "deny") {
    res.status(400).json({ error: "invalid_decision" });
    return;
  }

  try {
    if (decision === "approve") {
      await executeRconRequired(`verificacao liberar ${steamId}`);

      const result = "Jogador liberado da sessão de verificação.";

      await notifyTicket({
        channelId: ticketChannelId,
        discordUserId,
        steamId,
        decision,
        reason,
        result,
      });

      res.json({ ok: true, result });
      return;
    }

    // Libera a sessão antes do banimento para que o kick não seja tratado
    // como evasão/desconexão pelo plugin de verificação.
    await executeRconRequired(`verificacao liberar ${steamId}`);

    const punishment = await banPlayer({
      steamId,
      duration: "perm",
      reason,
      actor: {
        id: "VORKEN",
        name: "Painel Vorken",
        source: "system",
      },
    });

    const result = `Banimento permanente aplicado a ${punishment.playerName}.`;

    await notifyTicket({
      channelId: ticketChannelId,
      discordUserId,
      steamId,
      decision,
      reason,
      result,
    });

    res.json({ ok: true, result });
  } catch (error) {
    logger.error(
      { error, steamId, decision },
      "Vorken verification decision failed",
    );

    res.status(500).json({
      error: "vorken_decision_failed",
      message:
        error instanceof Error
          ? error.message
          : "Falha ao aplicar a decisão.",
    });
  }
});

export default router;

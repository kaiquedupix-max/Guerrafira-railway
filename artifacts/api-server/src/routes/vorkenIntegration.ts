import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { EmbedBuilder } from "discord.js";
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

function safeEvidenceUrl(value: unknown): string {
  try {
    const url = new URL(String(value || "").trim());
    return ["http:", "https:"].includes(url.protocol)
      ? url.href
      : "";
  } catch {
    return "";
  }
}

async function upsertVerificationStatus(args: {
  channelId?: string;
  analysisId: number;
  title: string;
  description: string;
  color: number;
  evidenceUrl?: string;
}): Promise<void> {
  const client = discordClient();
  const channelId = safe(args.channelId, 32);

  if (!client || !/^\d{16,20}$/.test(channelId)) return;

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased() || !channel.isSendable()) return;

  const marker = `GF_VORKEN_STATUS_${args.analysisId}`;

  const embed = new EmbedBuilder()
    .setColor(args.color)
    .setTitle(args.title)
    .setDescription(args.description)
    .setFooter({ text: marker })
    .setTimestamp();

  if (args.evidenceUrl) {
    embed.addFields({
      name: "Provas da verificação",
      value: `[Abrir evidências no Vorken](${args.evidenceUrl})`
    });
  }

  const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  const existing = recent?.find(message =>
    message.author.id === client.user?.id &&
    message.embeds.some(item => item.footer?.text === marker)
  );

  if (existing) {
    await existing.edit({ embeds: [embed] }).catch(() => {});
  } else {
    await channel.send({ embeds: [embed] }).catch(() => {});
  }
}

async function notifyTicket(args: {
  channelId?: string;
  discordUserId?: string;
  analysisId: number;
  steamId: string;
  decision: "approve" | "deny";
  reason: string;
  result: string;
  evidenceUrl?: string;
}): Promise<void> {
  const evidenceUrl = safeEvidenceUrl(args.evidenceUrl);

  await upsertVerificationStatus({
    channelId: args.channelId,
    analysisId: args.analysisId,
    title:
      args.decision === "deny"
        ? "🔨 Verificação encerrada · jogador banido"
        : "✅ Verificação encerrada · jogador liberado",
    description:
      args.decision === "deny"
        ? `**SteamID:** \`${args.steamId}\`\n**Motivo:** ${args.reason}\n${args.result}`
        : `**SteamID:** \`${args.steamId}\`\nA administração concluiu a análise e liberou o jogador.`,
    color:
      args.decision === "deny"
        ? 0xe74c3c
        : 0x22c55e,
    evidenceUrl: evidenceUrl || undefined,
  });
}

router.post("/integrations/vorken/progress", requireVorken, async (req, res) => {
  const analysisId = Number(req.body?.analysisId);
  const stage = safe(req.body?.stage, 40).toLowerCase();
  const ticketChannelId = safe(req.body?.ticketChannelId, 32);
  const analysisId = Number(req.body?.analysisId);
  const evidenceUrl = safeEvidenceUrl(req.body?.evidenceUrl);

  if (!Number.isInteger(analysisId) || analysisId <= 0) {
    res.status(400).json({ error: "invalid_analysis_id" });
    return;
  }

  const stages: Record<string, { title: string; description: string; color: number }> = {
    started: {
      title: "🟢 Verificação iniciada",
      description: "O Vorken foi aberto no computador do jogador e a coleta técnica foi iniciada.",
      color: 0x2bf0c9,
    },
    processing: {
      title: "🔎 Verificação em andamento",
      description: "A coleta do computador terminou. O relatório está sendo processado e classificado.",
      color: 0x4aa3ff,
    },
    completed: {
      title: "✅ Verificação finalizada",
      description: "A análise terminou. **Aguarde a decisão da administração.**",
      color: 0xf0b429,
    },
  };

  const state = stages[stage];

  if (!state) {
    res.status(400).json({ error: "invalid_progress_stage" });
    return;
  }

  await upsertVerificationStatus({
    channelId: ticketChannelId,
    analysisId,
    ...state,
  });

  res.json({ ok: true });
});

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

  if (!Number.isInteger(analysisId) || analysisId <= 0) {
    res.status(400).json({ error: "invalid_analysis_id" });
    return;
  }

  try {
    if (decision === "approve") {
      await executeRconRequired(`verificacao liberar ${steamId}`);

      const result = "Jogador liberado da sessão de verificação.";

      await notifyTicket({
        channelId: ticketChannelId,
        discordUserId,
        analysisId,
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
      evidenceUrl: evidenceUrl || undefined,
    });

    const result = `Banimento permanente aplicado a ${punishment.playerName}.`;

    await notifyTicket({
      channelId: ticketChannelId,
      discordUserId,
      analysisId,
      steamId,
      decision,
      reason,
      result,
      evidenceUrl: evidenceUrl || undefined,
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

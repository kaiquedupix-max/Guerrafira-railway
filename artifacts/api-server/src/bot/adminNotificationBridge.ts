import { Events, type Client, type Message } from "discord.js";
import { notifySubscribedAdmins, type AdminAlertKind } from "../admin/adminNotifications.js";
import { logger } from "../lib/logger.js";

function classify(title: string): { kind: AdminAlertKind; severity: "info" | "warning" | "critical" | "success" } {
  const t = title.toLowerCase();
  if (t.includes("anticheat") || t.includes("anti-cheat") || t.includes("detector de suspeita")) return { kind: "anticheat", severity: t.includes("crítico") ? "critical" : "warning" };
  if (t.includes("banimento") || t.includes("banido")) return { kind: "ban", severity: "critical" };
  if (t.includes("kick") || t.includes("quicado")) return { kind: "kick", severity: "warning" };
  if (t.includes("advert")) return { kind: "warn", severity: "warning" };
  if (t.includes("desban")) return { kind: "unban", severity: "success" };
  if (t.includes("verific")) return { kind: "verify", severity: "success" };
  if (t.includes("vip")) return { kind: "vip", severity: "info" };
  return { kind: "system", severity: "info" };
}

function fieldValue(message: Message, names: string[]): string | undefined {
  for (const embed of message.embeds) {
    for (const field of embed.fields || []) {
      if (names.some(n => field.name.toLowerCase().includes(n))) return field.value?.replace(/`/g, "").trim();
    }
  }
  return undefined;
}

export function startAdminNotificationBridge(client: Client): void {
  const channels = new Set([
    process.env.ANTICHEAT_LOG_CHANNEL_ID?.trim(),
    process.env.DISCORD_LOG_CHANNEL_ID?.trim(),
  ].filter(Boolean) as string[]);
  if (!channels.size) return;

  client.on(Events.MessageCreate, async (message) => {
    try {
      if (!channels.has(message.channelId)) return;
      if (message.author.id !== client.user?.id) return;
      const embed = message.embeds[0];
      const title = embed?.title || "Atualização da administração";
      const description = embed?.description || message.content || "Nova ação registrada no Guerra Fria.";
      const { kind, severity } = classify(title);
      const playerName = fieldValue(message, ["jogador", "player"]);
      const steamRaw = fieldValue(message, ["steamid", "steam"]);
      const steamId = steamRaw?.match(/7656119\d{10}/)?.[0];
      await notifySubscribedAdmins({
        kind,
        severity,
        title,
        message: description.slice(0, 1800),
        playerName: playerName?.split("\n")[0],
        steamId,
      });
    } catch (err) {
      logger.error({ err }, "Admin notification bridge failed");
    }
  });

  logger.info({ channels: [...channels] }, "Admin notification bridge enabled");
}

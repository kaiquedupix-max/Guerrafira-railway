import { EmbedBuilder } from "discord.js";
import { db, adminNotificationSubscriptionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { discordClient } from "../bot/client.js";
import { logger } from "../lib/logger.js";

export type AdminAlertKind = "anticheat" | "ban" | "kick" | "warn" | "unban" | "verify" | "vip" | "system";
export type AdminAlert = {
  id: string;
  kind: AdminAlertKind;
  title: string;
  message: string;
  playerName?: string;
  steamId?: string;
  severity: "info" | "warning" | "critical" | "success";
  createdAt: string;
};

const alerts: AdminAlert[] = [];

export function pushAdminAlert(alert: Omit<AdminAlert, "id" | "createdAt">): AdminAlert {
  const row: AdminAlert = {
    ...alert,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
  };
  alerts.unshift(row);
  if (alerts.length > 250) alerts.length = 250;
  return row;
}

export function getAdminAlerts(limit = 100): AdminAlert[] {
  return alerts.slice(0, Math.max(1, Math.min(250, limit)));
}

export async function setAdminDiscordNotifications(userId: string, enabled: boolean): Promise<void> {
  await db.insert(adminNotificationSubscriptionsTable).values({ discordUserId: userId, enabled, updatedAt: new Date() })
    .onConflictDoUpdate({ target: adminNotificationSubscriptionsTable.discordUserId, set: { enabled, updatedAt: new Date() } });
}

export async function getAdminDiscordNotificationState(userId: string): Promise<boolean> {
  const [row] = await db.select().from(adminNotificationSubscriptionsTable).where(eq(adminNotificationSubscriptionsTable.discordUserId, userId)).limit(1);
  return Boolean(row?.enabled);
}

export async function notifySubscribedAdmins(alert: Omit<AdminAlert, "id" | "createdAt">): Promise<void> {
  const row = pushAdminAlert(alert);
  const client = discordClient();
  if (!client) return;
  const subscribers = await db.select().from(adminNotificationSubscriptionsTable).where(eq(adminNotificationSubscriptionsTable.enabled, true)).catch(() => []);
  if (!subscribers.length) return;
  const color = row.severity === "critical" ? 0xef4444 : row.severity === "warning" ? 0xff9a2f : row.severity === "success" ? 0x22c55e : 0x8b5cf6;
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(row.title)
    .setDescription(row.message)
    .setFooter({ text: "Guerra Fria • Central de Controle" })
    .setTimestamp();
  if (row.playerName) embed.addFields({ name: "Jogador", value: row.playerName, inline: true });
  if (row.steamId) embed.addFields({ name: "SteamID", value: `\`${row.steamId}\``, inline: true });
  await Promise.all(subscribers.map(async sub => {
    const user = await client.users.fetch(sub.discordUserId).catch(() => null);
    if (!user) return;
    await user.send({ embeds: [embed] }).catch(err => logger.warn({ err, userId: sub.discordUserId }, "Failed to send admin DM notification"));
  }));
}

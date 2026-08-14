import { EmbedBuilder } from "discord.js";
import webpush from "web-push";
import { db, adminNotificationSubscriptionsTable, adminWebPushSubscriptionsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
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
let pushReady = false;

function configureWebPush(): boolean {
  if (pushReady) return true;
  const pub = process.env.WEB_PUSH_PUBLIC_KEY;
  const priv = process.env.WEB_PUSH_PRIVATE_KEY;
  if (!pub || !priv) return false;
  webpush.setVapidDetails(process.env.WEB_PUSH_SUBJECT || "mailto:admin@guerrafria.local", pub, priv);
  pushReady = true;
  return true;
}

async function ensureWebPushTable(): Promise<void> {
  await db.execute(sql`CREATE TABLE IF NOT EXISTS admin_web_push_subscriptions (
    id SERIAL PRIMARY KEY,
    discord_user_id TEXT NOT NULL,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
}

export function getWebPushPublicKey(): string | null {
  return process.env.WEB_PUSH_PUBLIC_KEY || null;
}

export function pushAdminAlert(alert: Omit<AdminAlert, "id" | "createdAt">): AdminAlert {
  const row: AdminAlert = { ...alert, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, createdAt: new Date().toISOString() };
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

export async function saveAdminWebPushSubscription(userId: string, subscription: { endpoint: string; keys: { p256dh: string; auth: string } }): Promise<void> {
  await ensureWebPushTable();
  await db.insert(adminWebPushSubscriptionsTable).values({
    discordUserId: userId,
    endpoint: subscription.endpoint,
    p256dh: subscription.keys.p256dh,
    auth: subscription.keys.auth,
    enabled: true,
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: adminWebPushSubscriptionsTable.endpoint,
    set: { discordUserId: userId, p256dh: subscription.keys.p256dh, auth: subscription.keys.auth, enabled: true, updatedAt: new Date() },
  });
}

export async function disableAdminWebPushSubscription(userId: string, endpoint?: string): Promise<void> {
  await ensureWebPushTable();
  if (endpoint) {
    await db.update(adminWebPushSubscriptionsTable).set({ enabled: false, updatedAt: new Date() }).where(eq(adminWebPushSubscriptionsTable.endpoint, endpoint));
    return;
  }
  await db.update(adminWebPushSubscriptionsTable).set({ enabled: false, updatedAt: new Date() }).where(eq(adminWebPushSubscriptionsTable.discordUserId, userId));
}

export async function getAdminWebPushState(userId: string): Promise<boolean> {
  await ensureWebPushTable();
  const rows = await db.select().from(adminWebPushSubscriptionsTable).where(eq(adminWebPushSubscriptionsTable.discordUserId, userId));
  return rows.some(r => r.enabled);
}

async function notifyWebPush(row: AdminAlert): Promise<void> {
  if (!configureWebPush()) return;
  await ensureWebPushTable();
  const subscribers = await db.select().from(adminWebPushSubscriptionsTable).where(eq(adminWebPushSubscriptionsTable.enabled, true)).catch(() => []);
  if (!subscribers.length) return;
  const payload = JSON.stringify({
    title: row.kind === "anticheat" ? `🛡️ ${row.title}` : row.severity === "critical" ? `🚨 ${row.title}` : row.title,
    body: row.message,
    url: "/admin",
    tag: `gf-${row.kind}-${row.id}`,
    severity: row.severity,
  });
  await Promise.all(subscribers.map(async sub => {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, { TTL: 3600, urgency: row.severity === "critical" ? "high" : "normal" });
    } catch (err: any) {
      if (err?.statusCode === 404 || err?.statusCode === 410) {
        await db.update(adminWebPushSubscriptionsTable).set({ enabled: false, updatedAt: new Date() }).where(eq(adminWebPushSubscriptionsTable.endpoint, sub.endpoint)).catch(() => {});
      }
      logger.warn({ err, endpoint: sub.endpoint.slice(0, 48) }, "Failed to send GF Admin web push notification");
    }
  }));
}

export async function notifySubscribedAdmins(alert: Omit<AdminAlert, "id" | "createdAt">): Promise<void> {
  const row = pushAdminAlert(alert);
  void notifyWebPush(row);
  const client = discordClient();
  if (!client) return;
  const subscribers = await db.select().from(adminNotificationSubscriptionsTable).where(eq(adminNotificationSubscriptionsTable.enabled, true)).catch(() => []);
  if (!subscribers.length) return;
  const color = row.severity === "critical" ? 0xef4444 : row.severity === "warning" ? 0xff9a2f : row.severity === "success" ? 0x22c55e : 0x8b5cf6;
  const embed = new EmbedBuilder().setColor(color).setTitle(row.title).setDescription(row.message).setFooter({ text: "Guerra Fria • Central de Controle" }).setTimestamp();
  if (row.playerName) embed.addFields({ name: "Jogador", value: row.playerName, inline: true });
  if (row.steamId) embed.addFields({ name: "SteamID", value: `\`${row.steamId}\``, inline: true });
  await Promise.all(subscribers.map(async sub => {
    const user = await client.users.fetch(sub.discordUserId).catch(() => null);
    if (!user) return;
    await user.send({ embeds: [embed] }).catch(err => logger.warn({ err, userId: sub.discordUserId }, "Failed to send admin DM notification"));
  }));
}

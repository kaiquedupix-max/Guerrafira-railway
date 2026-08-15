/**
 * VIP management — grant, revoke, expiry checker.
 */

import { type Client } from "discord.js";
import { eq, and, lte, or, gt } from "drizzle-orm";
import { db, vipSubscriptionsTable } from "@workspace/db";
import { executeRconCommand } from "./utils/rcon.js";
import { logger } from "../lib/logger.js";

export const VIP_TIERS = {
  bronze: { id: "bronze", name: "VIP Bronze", emoji: "🥉", price: parseFloat(process.env.VIP_BRONZE_PRICE ?? "29.90"), color: 0xcd7f32, benefits: [] as string[] },
  prata: { id: "prata", name: "VIP Prata", emoji: "🥈", price: parseFloat(process.env.VIP_PRATA_PRICE ?? "49.90"), color: 0xc0c0c0, benefits: [] as string[] },
  ouro: { id: "ouro", name: "VIP Ouro", emoji: "🥇", price: parseFloat(process.env.VIP_OURO_PRICE ?? "79.90"), color: 0xffd700, benefits: [] as string[] },
} as const;

export type VipTier = keyof typeof VIP_TIERS;

function buildRconCmd(envKey: string, steamId: string): string | null {
  const template = process.env[envKey];
  if (!template) {
    logger.warn({ envKey }, "RCON command env var not set — VIP action skipped in-game");
    return null;
  }
  return template.replace(/\{steam[Ii][Dd]\}/g, steamId);
}

async function executeVipRcon(command: string, action: "grant" | "revoke"): Promise<void> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await executeRconCommand(command);
      if (response !== null) return;
      lastError = new Error("RCON não confirmou o comando");
    } catch (err) {
      lastError = err;
    }
    if (attempt < 3) await new Promise(resolve => setTimeout(resolve, attempt * 750));
  }
  logger.error({ command, action, err: lastError }, "VIP RCON command failed after retries");
  throw new Error("O servidor Rust não confirmou a alteração do VIP. Tente novamente.");
}

export async function grantVip(opts: {
  discordUserId: string;
  steamId: string;
  tier: VipTier;
  durationDays: number;
  source: "purchase" | "raffle";
  client: Client;
}): Promise<void> {
  const { discordUserId, steamId, tier, durationDays, source, client } = opts;
  logger.info({ tier, steamId, discordUserId, durationDays, source }, "▶ grantVip started");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

  const grantCmd = buildRconCmd(`VIP_${tier.toUpperCase()}_GRANT_CMD`, steamId);
  if (!grantCmd) throw new Error(`Comando RCON do VIP ${tier} não configurado.`);
  await executeVipRcon(grantCmd, "grant");
  logger.info({ cmd: grantCmd }, "RCON grant command confirmed");

  const roleId = process.env.DISCORD_VIP_ROLE_ID;
  const guildId = process.env.DISCORD_GUILD_ID;
  if (roleId && guildId && discordUserId && !discordUserId.startsWith("manual")) {
    try {
      const guild = await client.guilds.fetch(guildId);
      const member = await guild.members.fetch(discordUserId).catch(() => null);
      if (!member) throw new Error("Membro não encontrado no servidor Discord");
      if (!member.roles.cache.has(roleId)) await member.roles.add(roleId, `VIP ${tier} concedido (${source})`);
    } catch (err) {
      const rollback = buildRconCmd(`VIP_${tier.toUpperCase()}_REVOKE_CMD`, steamId);
      if (rollback) await executeVipRcon(rollback, "revoke").catch(() => {});
      logger.error({ err, discordUserId, roleId, guildId }, "VIP Discord role failed; Rust grant rolled back");
      throw new Error("O VIP não foi entregue no Discord; a alteração no Rust foi revertida para nova tentativa.");
    }
  }

  await db.insert(vipSubscriptionsTable).values({ discordUserId, steamId, vipTier: tier, source, durationDays, startsAt: now, expiresAt });
  logger.info({ tier, steamId, discordUserId, expiresAt }, "✅ grantVip complete — DB saved");
}

export async function revokeVip(opts: {
  subscriptionId: number;
  tier: VipTier;
  steamId: string;
  discordUserId: string;
  client: Client;
}): Promise<void> {
  const { subscriptionId, tier, steamId, discordUserId, client } = opts;
  logger.info({ subscriptionId, tier, steamId }, "▶ revokeVip started");

  const now = new Date();
  const sameTier = await db.select().from(vipSubscriptionsTable).where(and(
    eq(vipSubscriptionsTable.steamId, steamId),
    eq(vipSubscriptionsTable.vipTier, tier),
    gt(vipSubscriptionsTable.expiresAt, now),
    eq(vipSubscriptionsTable.gameVipRemoved, false),
  ));
  const hasOtherSameTier = sameTier.some(s => s.id !== subscriptionId);
  if (!hasOtherSameTier) {
    const revokeCmd = buildRconCmd(`VIP_${tier.toUpperCase()}_REVOKE_CMD`, steamId);
    if (!revokeCmd) throw new Error(`Comando RCON de remoção do VIP ${tier} não configurado.`);
    await executeVipRcon(revokeCmd, "revoke");
  }

  const allForDiscord = discordUserId && discordUserId !== "manual-web"
    ? await db.select().from(vipSubscriptionsTable).where(eq(vipSubscriptionsTable.discordUserId, discordUserId))
    : [];
  const hasOtherVip = allForDiscord.some(s =>
    s.id !== subscriptionId &&
    new Date(s.expiresAt).getTime() > now.getTime() &&
    !s.gameVipRemoved
  );

  const roleId = process.env.DISCORD_VIP_ROLE_ID;
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!hasOtherVip && roleId && guildId && discordUserId && discordUserId !== "manual-web") {
    try {
      const guild = await client.guilds.fetch(guildId);
      const member = await guild.members.fetch(discordUserId).catch(() => null);
      if (member?.roles.cache.has(roleId)) await member.roles.remove(roleId, `VIP ${tier} removido`);
    } catch (err) { logger.error({ err }, "Failed to remove VIP Discord role"); }
  }

  // Expirar imediatamente é essencial: o painel determina VIP ativo por expiresAt.
  await db.update(vipSubscriptionsTable).set({
    expiresAt: now,
    discordRoleRemoved: !hasOtherVip,
    gameVipRemoved: true,
  }).where(eq(vipSubscriptionsTable.id, subscriptionId));

  logger.info({ subscriptionId, tier, steamId }, "✅ revokeVip complete");
}

export function startVipExpiryChecker(client: Client): void {
  const INTERVAL = 2 * 60 * 1000;
  async function check() {
    const now = new Date();
    const active = await db.select().from(vipSubscriptionsTable).where(and(
      gt(vipSubscriptionsTable.expiresAt, now),
      eq(vipSubscriptionsTable.gameVipRemoved, false),
    ));
    const reconciled = new Set<string>();
    for (const sub of active) {
      const key = `${sub.steamId}:${sub.vipTier}`;
      if (reconciled.has(key)) continue;
      reconciled.add(key);
      const command = buildRconCmd(`VIP_${String(sub.vipTier).toUpperCase()}_GRANT_CMD`, sub.steamId);
      if (!command) continue;
      await executeVipRcon(command, "grant").catch(err =>
        logger.error({ err, steamId: sub.steamId, tier: sub.vipTier }, "Active VIP reconciliation failed"),
      );
      const roleId = process.env.DISCORD_VIP_ROLE_ID, guildId = process.env.DISCORD_GUILD_ID;
      if (roleId && guildId && sub.discordUserId && !sub.discordUserId.startsWith("manual")) {
        const guild = await client.guilds.fetch(guildId).catch(() => null);
        const member = guild ? await guild.members.fetch(sub.discordUserId).catch(() => null) : null;
        if (member && !member.roles.cache.has(roleId)) {
          await member.roles.add(roleId, "Reconciliação automática de VIP").catch(err =>
            logger.error({ err, discordUserId: sub.discordUserId }, "VIP Discord role reconciliation failed"));
        }
      }
    }

    const expired = await db.select().from(vipSubscriptionsTable).where(and(
      lte(vipSubscriptionsTable.expiresAt, now),
      or(eq(vipSubscriptionsTable.gameVipRemoved, false), eq(vipSubscriptionsTable.discordRoleRemoved, false)),
    ));
    if (expired.length) logger.info({ count: expired.length }, "VIP expiry check — revoking expired");
    for (const sub of expired) {
      await revokeVip({ subscriptionId: sub.id, tier: sub.vipTier as VipTier, steamId: sub.steamId, discordUserId: sub.discordUserId, client })
        .catch(err => logger.error({ err, sub }, "VIP revoke error"));
    }
  }
  setTimeout(() => check().catch(err => logger.error({ err }, "Initial VIP reconciliation failed")), 15_000);
  setInterval(() => check().catch(err => logger.error({ err }, "VIP expiry check error")), INTERVAL);
}

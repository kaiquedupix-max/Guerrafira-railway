/**
 * VIP management — grant, revoke, expiry checker.
 */

import { type Client } from "discord.js";
import { eq, and, lte, or } from "drizzle-orm";
import { db, vipSubscriptionsTable } from "@workspace/db";
import { executeRconCommand } from "./utils/rcon.js";
import { logger } from "../lib/logger.js";

// ─── VIP tier definitions ─────────────────────────────────────────────────────
export const VIP_TIERS = {
  bronze: {
    id:    "bronze",
    name:  "VIP Bronze",
    emoji: "🥉",
    price: parseFloat(process.env.VIP_BRONZE_PRICE ?? "29.90"),
    color: 0xcd7f32,
    benefits: [] as string[],
  },
  prata: {
    id:    "prata",
    name:  "VIP Prata",
    emoji: "🥈",
    price: parseFloat(process.env.VIP_PRATA_PRICE ?? "49.90"),
    color: 0xc0c0c0,
    benefits: [] as string[],
  },
  ouro: {
    id:    "ouro",
    name:  "VIP Ouro",
    emoji: "🥇",
    price: parseFloat(process.env.VIP_OURO_PRICE ?? "79.90"),
    color: 0xffd700,
    benefits: [] as string[],
  },
} as const;

export type VipTier = keyof typeof VIP_TIERS;

function buildRconCmd(envKey: string, steamId: string): string | null {
  const template = process.env[envKey];
  if (!template) {
    logger.warn({ envKey }, "RCON command env var not set — VIP action skipped in-game");
    return null;
  }
  // aceita {steamId}, {steamid}, {STEAMID} — qualquer capitalização
  return template.replace(/\{steam[Ii][Dd]\}/g, steamId);
}

// ─── Grant VIP ────────────────────────────────────────────────────────────────
export async function grantVip(opts: {
  discordUserId: string;
  steamId:       string;
  tier:          VipTier;
  durationDays:  number;
  source:        "purchase" | "raffle";
  client:        Client;
}): Promise<void> {
  const { discordUserId, steamId, tier, durationDays, source, client } = opts;

  logger.info({ tier, steamId, discordUserId, durationDays, source }, "▶ grantVip started");

  const now       = new Date();
  const expiresAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

  // 1. RCON grant command
  const grantCmd = buildRconCmd(`VIP_${tier.toUpperCase()}_GRANT_CMD`, steamId);
  if (grantCmd) {
    logger.info({ cmd: grantCmd }, "Executing RCON grant command");
    try {
      await executeRconCommand(grantCmd);
      logger.info({ cmd: grantCmd }, "RCON grant command executed");
    } catch (err) {
      logger.error({ err, cmd: grantCmd }, "RCON grant command failed");
    }
  }

  // 2. Discord role
  const roleId  = process.env.DISCORD_VIP_ROLE_ID;
  const guildId = process.env.DISCORD_GUILD_ID;

  if (!roleId) logger.warn("DISCORD_VIP_ROLE_ID not set — skipping role assignment");
  if (!guildId) logger.warn("DISCORD_GUILD_ID not set — skipping role assignment");

  if (roleId && guildId) {
    try {
      const guild  = await client.guilds.fetch(guildId);
      const member = await guild.members.fetch(discordUserId).catch((e) => {
        logger.warn({ discordUserId, err: String(e) }, "Member not found in guild");
        return null;
      });
      if (member) {
        await member.roles.add(roleId, `VIP ${tier} concedido (${source})`);
        logger.info({ discordUserId, roleId, tag: member.user.tag }, "VIP Discord role assigned");
      }
    } catch (err) {
      logger.error({ err, discordUserId, roleId, guildId }, "Failed to assign VIP Discord role");
    }
  }

  // 3. Save to DB
  try {
    await db.insert(vipSubscriptionsTable).values({
      discordUserId,
      steamId,
      vipTier: tier,
      source,
      durationDays,
      startsAt: now,
      expiresAt,
    });
    logger.info({ tier, steamId, discordUserId, expiresAt }, "✅ grantVip complete — DB saved");
  } catch (err) {
    logger.error({ err }, "Failed to save VIP subscription to DB");
  }
}

// ─── Revoke VIP ───────────────────────────────────────────────────────────────
export async function revokeVip(opts: {
  subscriptionId: number;
  tier:           VipTier;
  steamId:        string;
  discordUserId:  string;
  client:         Client;
}): Promise<void> {
  const { subscriptionId, tier, steamId, discordUserId, client } = opts;

  logger.info({ subscriptionId, tier, steamId }, "▶ revokeVip started");

  // 1. RCON revoke
  const revokeCmd = buildRconCmd(`VIP_${tier.toUpperCase()}_REVOKE_CMD`, steamId);
  if (revokeCmd) {
    try {
      await executeRconCommand(revokeCmd);
      logger.info({ cmd: revokeCmd }, "RCON revoke command executed");
    } catch (err) {
      logger.error({ err, cmd: revokeCmd }, "RCON revoke command failed");
    }
  }

  // 2. Discord role (only if no other active VIP)
  const otherActive = await db
    .select()
    .from(vipSubscriptionsTable)
    .where(and(eq(vipSubscriptionsTable.discordUserId, discordUserId), eq(vipSubscriptionsTable.discordRoleRemoved, false)));

  const hasOtherVip = otherActive.some((s) => s.id !== subscriptionId);
  const roleId      = process.env.DISCORD_VIP_ROLE_ID;
  const guildId     = process.env.DISCORD_GUILD_ID;

  if (!hasOtherVip && roleId && guildId) {
    try {
      const guild  = await client.guilds.fetch(guildId);
      const member = await guild.members.fetch(discordUserId).catch(() => null);
      if (member) {
        await member.roles.remove(roleId, `VIP ${tier} expirado`);
        logger.info({ discordUserId, roleId }, "VIP Discord role removed");
      }
    } catch (err) {
      logger.error({ err }, "Failed to remove VIP Discord role");
    }
  }

  // 3. Mark DB
  await db
    .update(vipSubscriptionsTable)
    .set({ discordRoleRemoved: !hasOtherVip, gameVipRemoved: true })
    .where(eq(vipSubscriptionsTable.id, subscriptionId));

  logger.info({ subscriptionId, tier, steamId }, "✅ revokeVip complete");
}

// ─── Expiry checker ───────────────────────────────────────────────────────────
export function startVipExpiryChecker(client: Client): void {
  const INTERVAL = 10 * 60 * 1000;

  async function check() {
    const now     = new Date();
    const expired = await db
      .select()
      .from(vipSubscriptionsTable)
      .where(
        and(
          lte(vipSubscriptionsTable.expiresAt, now),
          or(eq(vipSubscriptionsTable.gameVipRemoved, false), eq(vipSubscriptionsTable.discordRoleRemoved, false)),
        ),
      );

    if (expired.length) logger.info({ count: expired.length }, "VIP expiry check — revoking expired");

    for (const sub of expired) {
      await revokeVip({
        subscriptionId: sub.id,
        tier:           sub.vipTier as VipTier,
        steamId:        sub.steamId,
        discordUserId:  sub.discordUserId,
        client,
      }).catch((err) => logger.error({ err, sub }, "VIP revoke error"));
    }
  }

  setTimeout(() => check().catch(() => {}), 30_000);
  setInterval(() => check().catch((err) => logger.error({ err }, "VIP expiry check error")), INTERVAL);
}

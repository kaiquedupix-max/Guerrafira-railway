/**
 * VIP management — grant, revoke, expiry checker.
 */

import { type Client } from "discord.js";
import { eq, and, lte, gt } from "drizzle-orm";
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
  const template = process.env[envKey]?.trim();
  if (!template) {
    logger.warn({ envKey }, "RCON command env var not set — VIP action skipped in-game");
    return null;
  }
  // Mantém compatibilidade com as variáveis antigas do Railway após a
  // migração do servidor de Oxide para Carbon.
  return template
    .replace(/^oxide\./i, "c.")
    .replace(/\{steam[Ii][Dd]\}/g, steamId);
}

function rconResponseLooksLikeError(response: string): boolean {
  const text = response.trim().toLowerCase();
  if (!text) return false;
  return [
    "unknown command",
    "command not found",
    "no command",
    "invalid command",
    "not recognized",
    "does not exist",
    "failed",
    "exception",
    "error:",
  ].some(marker => text.includes(marker));
}

async function executeVipRcon(command: string, action: "grant" | "revoke"): Promise<string> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await executeRconCommand(command);
      if (response !== null && !rconResponseLooksLikeError(response)) {
        logger.info({ command, action, response: response.slice(0, 500) }, "VIP RCON command confirmed");
        return response;
      }
      lastError = new Error(response === null ? "RCON não confirmou o comando" : `RCON respondeu com erro: ${response}`);
    } catch (err) {
      lastError = err;
    }
    if (attempt < 3) await new Promise(resolve => setTimeout(resolve, attempt * 750));
  }
  logger.error({ command, action, err: lastError }, "VIP RCON command failed after retries");
  throw new Error("O servidor Rust não confirmou a alteração do VIP. Tente novamente.");
}

async function notifyVipExpired(opts: {
  client: Client;
  tier: VipTier;
  steamId: string;
  discordUserId: string;
}): Promise<void> {
  const { client, tier, steamId, discordUserId } = opts;
  const channelId = process.env.DISCORD_LOG_CHANNEL_ID?.trim();
  if (!channelId) return;

  try {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel?.isSendable()) {
      logger.warn({ channelId }, "VIP expiry notification channel unavailable");
      return;
    }

    const tierInfo = VIP_TIERS[tier];
    await channel.send({
      embeds: [{
        color: 0x2ecc71,
        title: "✅ VIP removido por expiração",
        description: "O VIP expirou e foi removido com sucesso do jogador.",
        fields: [
          { name: "VIP", value: `${tierInfo.emoji} ${tierInfo.name}`, inline: true },
          { name: "Steam ID", value: `\`${steamId}\``, inline: true },
          ...(discordUserId && !discordUserId.startsWith("manual")
            ? [{ name: "Discord", value: `<@${discordUserId}>`, inline: true }]
            : []),
          { name: "Motivo", value: "Expiração automática", inline: true },
        ],
        footer: { text: "Guerra Fria • Sistema automático de VIP" },
        timestamp: new Date().toISOString(),
      }],
      allowedMentions: { parse: [] },
    });
  } catch (err) {
    logger.error({ err, steamId, tier }, "Failed to send VIP expiry notification");
  }
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
  reason?: "manual" | "expired" | "reconcile";
}): Promise<void> {
  const { subscriptionId, tier, steamId, discordUserId, client, reason = "manual" } = opts;
  logger.info({ subscriptionId, tier, steamId, reason }, "▶ revokeVip started");

  const now = new Date();
  const sameTier = await db.select().from(vipSubscriptionsTable).where(and(
    eq(vipSubscriptionsTable.steamId, steamId),
    eq(vipSubscriptionsTable.vipTier, tier),
    gt(vipSubscriptionsTable.expiresAt, now),
    eq(vipSubscriptionsTable.gameVipRemoved, false),
  ));
  const hasOtherSameTier = sameTier.some(s => s.id !== subscriptionId);
  let gameVipRemoved = hasOtherSameTier;

  if (!hasOtherSameTier) {
    const revokeCmd = buildRconCmd(`VIP_${tier.toUpperCase()}_REVOKE_CMD`, steamId);
    if (!revokeCmd) throw new Error(`Comando RCON de remoção do VIP ${tier} não configurado.`);
    await executeVipRcon(revokeCmd, "revoke");
    gameVipRemoved = true;
  }

  const allForDiscord = discordUserId && !discordUserId.startsWith("manual")
    ? await db.select().from(vipSubscriptionsTable).where(eq(vipSubscriptionsTable.discordUserId, discordUserId))
    : [];
  const hasOtherVip = allForDiscord.some(s =>
    s.id !== subscriptionId &&
    new Date(s.expiresAt).getTime() > now.getTime() &&
    !s.gameVipRemoved
  );

  const roleId = process.env.DISCORD_VIP_ROLE_ID;
  const guildId = process.env.DISCORD_GUILD_ID;
  let discordRoleRemoved = hasOtherVip || !discordUserId || discordUserId.startsWith("manual");

  if (!hasOtherVip && roleId && guildId && discordUserId && !discordUserId.startsWith("manual")) {
    const guild = await client.guilds.fetch(guildId);
    const member = await guild.members.fetch(discordUserId).catch(() => null);
    if (!member) {
      // Usuário fora do Discord: não existe cargo para remover.
      discordRoleRemoved = true;
    } else if (member.roles.cache.has(roleId)) {
      await member.roles.remove(roleId, `VIP ${tier} removido por ${reason === "expired" ? "expiração" : "administração"}`);
      discordRoleRemoved = true;
    } else {
      discordRoleRemoved = true;
    }
  } else if (!hasOtherVip && (!roleId || !guildId) && discordUserId && !discordUserId.startsWith("manual")) {
    discordRoleRemoved = false;
    logger.warn({ roleId, guildId, discordUserId }, "VIP Discord role removal could not run — configuration missing");
  }

  // Só marcamos como removido depois que cada etapa correspondente realmente terminou.
  await db.update(vipSubscriptionsTable).set({
    expiresAt: reason === "manual" ? now : undefined,
    discordRoleRemoved,
    gameVipRemoved,
  }).where(eq(vipSubscriptionsTable.id, subscriptionId));

  if (!gameVipRemoved || !discordRoleRemoved) {
    throw new Error(`VIP não foi totalmente removido (jogo=${gameVipRemoved}, discord=${discordRoleRemoved})`);
  }

  logger.info({ subscriptionId, tier, steamId, reason }, "✅ revokeVip complete");

  if (reason === "expired" || reason === "reconcile") {
    await notifyVipExpired({ client, tier, steamId, discordUserId });
  }
}

export function startVipExpiryChecker(client: Client): void {
  const INTERVAL = 2 * 60 * 1000;
  const processedExpired = new Set<number>();

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

    // Busca TODOS os expirados uma vez por processo. Isso corrige registros antigos
    // que podem ter sido marcados como removidos mesmo quando o RCON falhou.
    const expired = await db.select().from(vipSubscriptionsTable).where(lte(vipSubscriptionsTable.expiresAt, now));
    const pending = expired.filter(sub => !processedExpired.has(sub.id));
    if (pending.length) logger.info({ count: pending.length }, "VIP expiry check — reconciling expired VIPs");

    for (const sub of pending) {
      try {
        await revokeVip({
          subscriptionId: sub.id,
          tier: sub.vipTier as VipTier,
          steamId: sub.steamId,
          discordUserId: sub.discordUserId,
          client,
          reason: sub.gameVipRemoved && sub.discordRoleRemoved ? "reconcile" : "expired",
        });
        processedExpired.add(sub.id);
      } catch (err) {
        logger.error({ err, sub }, "VIP revoke error — will retry on next check");
      }
    }
  }

  setTimeout(() => check().catch(err => logger.error({ err }, "Initial VIP reconciliation failed")), 15_000);
  setInterval(() => check().catch(err => logger.error({ err }, "VIP expiry check error")), INTERVAL);
}

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type ButtonInteraction,
  type Client,
  type ModalSubmitInteraction,
  type TextChannel,
} from "discord.js";
import { and, eq, lte, sql } from "drizzle-orm";
import { db, rafflesTable, raffleEntriesTable, boosterLinksTable } from "@workspace/db";
import { grantVip, VIP_TIERS, type VipTier } from "./vip.js";
import { executeRconCommand } from "./utils/rcon.js";
import { logger } from "../lib/logger.js";

// Os sorteios que já existiam quando esta correção foi solicitada não podem ser executados.
// Novos sorteios só serão criados após a nova versão entrar no ar, então este corte é seguro.
const CANCEL_LEGACY_ACTIVE_BEFORE = new Date("2026-09-07T15:23:00.000Z");

async function ensureRaffleColumns(): Promise<void> {
  await db.execute(sql`ALTER TABLE raffles ADD COLUMN IF NOT EXISTS prize_text TEXT`);
  await db.execute(sql`ALTER TABLE raffles ADD COLUMN IF NOT EXISTS vip_only BOOLEAN NOT NULL DEFAULT FALSE`);
  await db.execute(sql`ALTER TABLE raffles ADD COLUMN IF NOT EXISTS winner_count INTEGER NOT NULL DEFAULT 1`);
  await db.execute(sql`ALTER TABLE raffles ADD COLUMN IF NOT EXISTS winner_discord_ids TEXT`);
}

function safePrize(value: unknown): string {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, 300);
}

function normalizeWinnerCount(value: unknown): 1 | 2 {
  return Number(value) === 2 ? 2 : 1;
}

function pickRandomWinners<T>(entries: T[], requested: number): T[] {
  const pool = [...entries];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const current = pool[i]!;
    pool[i] = pool[j]!;
    pool[j] = current;
  }
  return pool.slice(0, Math.min(requested, pool.length));
}

export async function createRaffleCampaign(opts: {
  client: Client;
  prize: string;
  raffleHours: number;
  winnerCount: number;
  vipOnly: boolean;
  createdBy: string;
}): Promise<{ id: number; endsAt: Date }> {
  await ensureRaffleColumns();

  const prize = safePrize(opts.prize);
  if (!prize) throw new Error("Informe o prêmio do sorteio.");
  if (!Number.isFinite(opts.raffleHours) || opts.raffleHours <= 0 || opts.raffleHours > 24 * 30) {
    throw new Error("Duração do sorteio inválida.");
  }

  const winnerCount = normalizeWinnerCount(opts.winnerCount);
  const endsAt = new Date(Date.now() + opts.raffleHours * 60 * 60 * 1000);
  const [raffle] = await db.insert(rafflesTable).values({
    prizeTier: opts.vipOnly ? "vip-custom" : "community",
    prizeDurationDays: 0,
    prizeText: prize,
    vipOnly: opts.vipOnly,
    winnerCount,
    endsAt,
    createdBy: opts.createdBy,
    status: "active",
  }).returning();
  if (!raffle) throw new Error("Não foi possível criar o sorteio.");

  const raffleChannelId = process.env.DISCORD_RAFFLE_CHANNEL_ID;
  if (!raffleChannelId) throw new Error("DISCORD_RAFFLE_CHANNEL_ID não configurado.");
  const raffleChannel = await opts.client.channels.fetch(raffleChannelId).catch(() => null) as TextChannel | null;
  if (!raffleChannel?.isSendable()) throw new Error("Canal de sorteios indisponível.");

  const message = await raffleChannel.send({
    embeds: [buildRaffleEmbed(raffle.id, prize, 0, endsAt, opts.vipOnly, winnerCount)],
    components: [buildRaffleRow()],
  });
  await db.update(rafflesTable)
    .set({ messageId: message.id, channelId: message.channelId })
    .where(eq(rafflesTable.id, raffle.id));

  const audienceText = opts.vipOnly ? "Somente membros VIP podem participar." : "Todos os membros podem participar.";
  const notice = [
    opts.vipOnly ? "🎉 **SORTEIO VIP!**" : "🎉 **NOVO SORTEIO!**",
    `🎁 Prêmio: **${prize}**`,
    `🏆 ${winnerCount} ${winnerCount === 1 ? "vencedor" : "vencedores"}`,
    `👥 ${audienceText}`,
    `👉 Participe em <#${raffleChannelId}>`,
    `⏰ Encerra <t:${Math.floor(endsAt.getTime() / 1000)}:R>.`,
  ].join("\n");

  const destinationIds = new Set([
    process.env.DISCORD_CHAT_CHANNEL_ID,
    process.env.DISCORD_ANNOUNCEMENTS_CHANNEL_ID,
  ].filter((id): id is string => Boolean(id && id !== raffleChannelId)));

  for (const channelId of destinationIds) {
    const channel = await opts.client.channels.fetch(channelId).catch(() => null) as TextChannel | null;
    if (channel?.isSendable()) {
      await channel.send(notice).catch((err) => logger.warn({ err, channelId }, "Raffle announcement failed"));
    }
  }

  const rconAudience = opts.vipOnly ? "Exclusivo para VIPs" : "Aberto para todos";
  await executeRconCommand(
    `say [SORTEIO] Premio: ${prize}. ${winnerCount} ${winnerCount === 1 ? "vencedor" : "vencedores"}. ${rconAudience}. Participe no Discord: discord.gg/guerrafria`,
  ).catch(() => {});

  const delay = endsAt.getTime() - Date.now();
  if (delay > 0) setTimeout(() => void drawRaffleWinner(opts.client, raffle.id), delay);

  return { id: raffle.id, endsAt };
}

export async function createVipOnlyRaffle(opts: {
  client: Client;
  prize: string;
  raffleHours: number;
  createdBy: string;
}): Promise<{ id: number; endsAt: Date }> {
  return createRaffleCampaign({ ...opts, winnerCount: 1, vipOnly: true });
}

/** Mantém compatibilidade com chamadas antigas, caso algum módulo ainda use createRaffle. */
export async function createRaffle(opts: {
  client: Client;
  tier: VipTier;
  vipDurationDays: number;
  raffleHours: number;
  createdBy: string;
}): Promise<void> {
  await ensureRaffleColumns();
  const vip = VIP_TIERS[opts.tier];
  const endsAt = new Date(Date.now() + opts.raffleHours * 60 * 60 * 1000);
  const [raffle] = await db.insert(rafflesTable).values({
    prizeTier: opts.tier,
    prizeDurationDays: opts.vipDurationDays,
    prizeText: `${vip.emoji} ${vip.name} por ${opts.vipDurationDays} dias`,
    vipOnly: false,
    winnerCount: 1,
    endsAt,
    createdBy: opts.createdBy,
    status: "active",
  }).returning();
  if (!raffle) throw new Error("Failed to create raffle");
}

async function isVipMember(interaction: ButtonInteraction): Promise<boolean> {
  const roleId = process.env.DISCORD_VIP_ROLE_ID?.trim();
  if (!roleId || !interaction.guild) return false;
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  return Boolean(member?.roles.cache.has(roleId));
}

export async function handleRaffleJoin(interaction: ButtonInteraction): Promise<void> {
  await ensureRaffleColumns();
  const [raffle] = await db.select().from(rafflesTable).where(and(
    eq(rafflesTable.messageId, interaction.message.id),
    eq(rafflesTable.status, "active"),
  ));

  if (!raffle) {
    await interaction.reply({ content: "❌ Este sorteio não está mais ativo.", ephemeral: true });
    return;
  }

  if (raffle.vipOnly && !(await isVipMember(interaction))) {
    await interaction.reply({
      content: "🔒 Este sorteio é exclusivo para membros VIP. Você precisa estar com o cargo VIP ativo para participar.",
      ephemeral: true,
    });
    return;
  }

  const [existing] = await db.select().from(raffleEntriesTable).where(and(
    eq(raffleEntriesTable.raffleId, raffle.id),
    eq(raffleEntriesTable.discordUserId, interaction.user.id),
  ));
  if (existing) {
    await interaction.reply({ content: "✅ Você já está participando deste sorteio!", ephemeral: true });
    return;
  }

  const [linked] = await db.select().from(boosterLinksTable)
    .where(eq(boosterLinksTable.discordUserId, interaction.user.id))
    .limit(1);
  const steamId = linked?.steamId || "DISCORD-ONLY";

  await db.insert(raffleEntriesTable).values({
    raffleId: raffle.id,
    discordUserId: interaction.user.id,
    steamId,
  });

  const entries = await db.select().from(raffleEntriesTable).where(eq(raffleEntriesTable.raffleId, raffle.id));
  await updateRaffleMessage(interaction.client, raffle, entries.length);
  await interaction.reply({ content: `🎟️ Participação confirmada! Boa sorte, <@${interaction.user.id}>.`, ephemeral: true });
}

/** Mantido por compatibilidade com o dispatcher antigo. */
export async function handleRaffleModal(interaction: ModalSubmitInteraction): Promise<void> {
  await interaction.reply({
    content: "ℹ️ Este sorteio não exige vinculação manual de Steam. Use o botão Participar.",
    ephemeral: true,
  }).catch(() => {});
}

export async function drawRaffleWinner(client: Client, raffleId: number): Promise<void> {
  await ensureRaffleColumns();
  const [raffle] = await db.select().from(rafflesTable).where(eq(rafflesTable.id, raffleId));
  if (!raffle || raffle.status !== "active") return;

  const entries = await db.select().from(raffleEntriesTable).where(eq(raffleEntriesTable.raffleId, raffleId));
  const requestedWinners = normalizeWinnerCount(raffle.winnerCount);
  const winners = pickRandomWinners(entries, requestedWinners);
  const prize = safePrize(raffle.prizeText) || raffle.prizeTier;

  await db.update(rafflesTable).set({ status: "completed" }).where(eq(rafflesTable.id, raffleId));

  if (!winners.length) {
    await editEndedMessage(client, raffle, prize, []);
    return;
  }

  await db.update(rafflesTable).set({
    winnerDiscordId: winners[0]!.discordUserId,
    winnerDiscordIds: JSON.stringify(winners.map((winner) => winner.discordUserId)),
    winnerSteamId: winners[0]!.steamId,
  }).where(eq(rafflesTable.id, raffleId));

  if (!raffle.vipOnly && raffle.prizeTier in VIP_TIERS) {
    for (const winner of winners) {
      if (!/^\d{17}$/.test(winner.steamId)) continue;
      await grantVip({
        discordUserId: winner.discordUserId,
        steamId: winner.steamId,
        tier: raffle.prizeTier as VipTier,
        durationDays: raffle.prizeDurationDays,
        source: "raffle",
        client,
      }).catch((err) => logger.error({ err, raffleId, userId: winner.discordUserId }, "Legacy VIP raffle grant failed"));
    }
  }

  const winnerIds = winners.map((winner) => winner.discordUserId);
  await editEndedMessage(client, raffle, prize, winnerIds);

  const winnerLabel = winnerIds.length === 1 ? "🏆 Vencedor" : "🏆 Vencedores";
  const winnerMentions = winnerIds.map((id, index) => `${index + 1}º <@${id}>`).join("\n");
  const resultText = [
    raffle.vipOnly ? "🎊 **RESULTADO DO SORTEIO VIP!**" : "🎊 **RESULTADO DO SORTEIO!**",
    `${winnerLabel}:`,
    winnerMentions,
    `🎁 Prêmio: **${prize}**`,
  ].join("\n");

  if (raffle.channelId) {
    const channel = await client.channels.fetch(raffle.channelId).catch(() => null) as TextChannel | null;
    if (channel?.isSendable()) await channel.send(resultText).catch(() => {});
  }
}

async function cancelLegacyActiveRaffles(client: Client): Promise<number> {
  const legacyActive = await db.select().from(rafflesTable).where(and(
    eq(rafflesTable.status, "active"),
    lte(rafflesTable.createdAt, CANCEL_LEGACY_ACTIVE_BEFORE),
  ));

  for (const raffle of legacyActive) {
    await db.update(rafflesTable)
      .set({ status: "cancelled" })
      .where(and(eq(rafflesTable.id, raffle.id), eq(rafflesTable.status, "active")));
    await editCancelledMessage(client, raffle).catch(() => {});
    logger.info({ raffleId: raffle.id }, "Legacy active raffle cancelled by 2026-09-07 raffle repair");
  }

  return legacyActive.length;
}

export async function checkExpiredRaffles(client: Client): Promise<void> {
  await ensureRaffleColumns();

  // Primeiro cancela os sorteios antigos que o administrador pediu para não executar.
  await cancelLegacyActiveRaffles(client);

  const now = new Date();
  const expired = await db.select().from(rafflesTable).where(and(
    eq(rafflesTable.status, "active"),
    lte(rafflesTable.endsAt, now),
  ));
  for (const raffle of expired) {
    await drawRaffleWinner(client, raffle.id).catch((err) => logger.error({ err, raffleId: raffle.id }, "Startup raffle draw error"));
  }

  const active = await db.select().from(rafflesTable).where(eq(rafflesTable.status, "active"));
  for (const raffle of active) {
    const delay = raffle.endsAt.getTime() - Date.now();
    if (delay > 0) setTimeout(() => void drawRaffleWinner(client, raffle.id), delay);
  }
}

function buildRaffleEmbed(
  id: number,
  prize: string,
  entries: number,
  endsAt: Date,
  vipOnly: boolean,
  winnerCount: number,
): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(vipOnly ? 0xf59e0b : 0x3b82f6)
    .setTitle(vipOnly ? "🎉 Sorteio VIP — Guerra Fria" : "🎉 Sorteio — Guerra Fria")
    .setDescription(
      vipOnly
        ? "🔒 **Exclusivo para membros VIP.** Clique em **Participar** para entrar no sorteio."
        : "🌐 **Aberto para todos os membros.** Clique em **Participar** para entrar no sorteio.",
    )
    .addFields(
      { name: "🎁 Prêmio", value: `**${prize}**`, inline: false },
      { name: "🏆 Vencedores", value: `**${winnerCount}**`, inline: true },
      { name: "👥 Participantes", value: `**${entries}**`, inline: true },
      { name: "⏰ Encerra", value: `<t:${Math.floor(endsAt.getTime() / 1000)}:R>`, inline: true },
    )
    .setFooter({ text: `Sorteio #${id} • Guerra Fria` })
    .setTimestamp();
}

function buildRaffleRow() {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("raffle_join")
      .setLabel("🎟️ Participar")
      .setStyle(ButtonStyle.Success),
  );
}

async function updateRaffleMessage(
  client: Client,
  raffle: typeof rafflesTable.$inferSelect,
  entryCount: number,
): Promise<void> {
  if (!raffle.channelId || !raffle.messageId) return;
  const channel = await client.channels.fetch(raffle.channelId).catch(() => null) as TextChannel | null;
  const message = channel ? await channel.messages.fetch(raffle.messageId).catch(() => null) : null;
  if (!message) return;

  const prize = safePrize(raffle.prizeText) || raffle.prizeTier;
  await message.edit({
    embeds: [buildRaffleEmbed(
      raffle.id,
      prize,
      entryCount,
      raffle.endsAt,
      raffle.vipOnly,
      normalizeWinnerCount(raffle.winnerCount),
    )],
    components: [buildRaffleRow()],
  });
}

async function editEndedMessage(
  client: Client,
  raffle: typeof rafflesTable.$inferSelect,
  prize: string,
  winnerDiscordIds: string[],
): Promise<void> {
  if (!raffle.channelId || !raffle.messageId) return;
  const channel = await client.channels.fetch(raffle.channelId).catch(() => null) as TextChannel | null;
  const message = channel ? await channel.messages.fetch(raffle.messageId).catch(() => null) : null;
  if (!message) return;

  const winnerText = winnerDiscordIds.length
    ? winnerDiscordIds.map((id, index) => `${index + 1}º <@${id}>`).join("\n")
    : "Nenhum participante.";

  const embed = new EmbedBuilder()
    .setColor(winnerDiscordIds.length ? 0x22c55e : 0x64748b)
    .setTitle(raffle.vipOnly ? "🏆 Sorteio VIP encerrado" : "🏆 Sorteio encerrado")
    .setDescription(`${winnerText}\n\n🎁 **${prize}**`)
    .setTimestamp();

  await message.edit({ embeds: [embed], components: [] });
}

async function editCancelledMessage(
  client: Client,
  raffle: typeof rafflesTable.$inferSelect,
): Promise<void> {
  if (!raffle.channelId || !raffle.messageId) return;
  const channel = await client.channels.fetch(raffle.channelId).catch(() => null) as TextChannel | null;
  const message = channel ? await channel.messages.fetch(raffle.messageId).catch(() => null) : null;
  if (!message) return;

  const prize = safePrize(raffle.prizeText) || raffle.prizeTier;
  const embed = new EmbedBuilder()
    .setColor(0x64748b)
    .setTitle("🚫 Sorteio cancelado")
    .setDescription(`Este sorteio foi **cancelado pela administração** e não terá vencedor.\n\n🎁 Prêmio que estava anunciado: **${prize}**`)
    .setFooter({ text: `Sorteio #${raffle.id} • Guerra Fria` })
    .setTimestamp();

  await message.edit({ embeds: [embed], components: [] });
}

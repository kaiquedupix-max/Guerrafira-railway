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

async function ensureVipRaffleColumns(): Promise<void> {
  await db.execute(sql`ALTER TABLE raffles ADD COLUMN IF NOT EXISTS prize_text TEXT`);
  await db.execute(sql`ALTER TABLE raffles ADD COLUMN IF NOT EXISTS vip_only BOOLEAN NOT NULL DEFAULT FALSE`);
}

function safePrize(value: unknown): string {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, 300);
}

export async function createVipOnlyRaffle(opts: {
  client: Client;
  prize: string;
  raffleHours: number;
  createdBy: string;
}): Promise<{ id: number; endsAt: Date }> {
  await ensureVipRaffleColumns();
  const prize = safePrize(opts.prize);
  if (!prize) throw new Error("Informe o prêmio do sorteio.");
  if (!Number.isFinite(opts.raffleHours) || opts.raffleHours <= 0 || opts.raffleHours > 24 * 30) {
    throw new Error("Duração do sorteio inválida.");
  }

  const endsAt = new Date(Date.now() + opts.raffleHours * 60 * 60 * 1000);
  const [raffle] = await db.insert(rafflesTable).values({
    prizeTier: "vip-exclusive",
    prizeDurationDays: 0,
    prizeText: prize,
    vipOnly: true,
    endsAt,
    createdBy: opts.createdBy,
    status: "active",
  }).returning();
  if (!raffle) throw new Error("Não foi possível criar o sorteio VIP.");

  const raffleChannelId = process.env.DISCORD_RAFFLE_CHANNEL_ID;
  if (!raffleChannelId) throw new Error("DISCORD_RAFFLE_CHANNEL_ID não configurado.");
  const raffleChannel = await opts.client.channels.fetch(raffleChannelId).catch(() => null) as TextChannel | null;
  if (!raffleChannel?.isSendable()) throw new Error("Canal de sorteios indisponível.");

  const message = await raffleChannel.send({
    embeds: [buildVipRaffleEmbed(raffle.id, prize, 0, endsAt)],
    components: [buildRaffleRow()],
  });
  await db.update(rafflesTable).set({ messageId: message.id, channelId: message.channelId }).where(eq(rafflesTable.id, raffle.id));

  const notice = `🎉 **SORTEIO EXCLUSIVO PARA VIPS!**\n🎁 Prêmio: **${prize}**\n🔒 Somente membros VIP podem participar.\n👉 Participe em <#${raffleChannelId}>\n⏰ Encerra <t:${Math.floor(endsAt.getTime() / 1000)}:R>.`;
  const destinationIds = new Set([
    process.env.DISCORD_CHAT_CHANNEL_ID,
    process.env.DISCORD_ANNOUNCEMENTS_CHANNEL_ID,
  ].filter((id): id is string => Boolean(id && id !== raffleChannelId)));

  for (const channelId of destinationIds) {
    const channel = await opts.client.channels.fetch(channelId).catch(() => null) as TextChannel | null;
    if (channel?.isSendable()) await channel.send(notice).catch(err => logger.warn({ err, channelId }, "VIP raffle announcement failed"));
  }

  await executeRconCommand(`say [SORTEIO VIP] Premio: ${prize}. Exclusivo para VIPs. Participe no Discord: discord.gg/guerrafria`).catch(() => {});

  const delay = endsAt.getTime() - Date.now();
  if (delay > 0) setTimeout(() => void drawRaffleWinner(opts.client, raffle.id), delay);
  return { id: raffle.id, endsAt };
}

/** Mantém compatibilidade com chamadas antigas, caso algum módulo ainda use createRaffle. */
export async function createRaffle(opts: {
  client: Client;
  tier: VipTier;
  vipDurationDays: number;
  raffleHours: number;
  createdBy: string;
}): Promise<void> {
  await ensureVipRaffleColumns();
  const vip = VIP_TIERS[opts.tier];
  const endsAt = new Date(Date.now() + opts.raffleHours * 60 * 60 * 1000);
  const [raffle] = await db.insert(rafflesTable).values({
    prizeTier: opts.tier,
    prizeDurationDays: opts.vipDurationDays,
    prizeText: `${vip.emoji} ${vip.name} por ${opts.vipDurationDays} dias`,
    vipOnly: false,
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
  await ensureVipRaffleColumns();
  const [raffle] = await db.select().from(rafflesTable).where(and(
    eq(rafflesTable.messageId, interaction.message.id),
    eq(rafflesTable.status, "active"),
  ));
  if (!raffle) {
    await interaction.reply({ content: "❌ Este sorteio não está mais ativo.", ephemeral: true });
    return;
  }

  if (raffle.vipOnly && !(await isVipMember(interaction))) {
    await interaction.reply({ content: "🔒 Este sorteio é exclusivo para membros VIP. Você precisa estar com o cargo VIP ativo para participar.", ephemeral: true });
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

  const [linked] = await db.select().from(boosterLinksTable).where(eq(boosterLinksTable.discordUserId, interaction.user.id)).limit(1);
  const steamId = linked?.steamId || "VIP-DISCORD";
  await db.insert(raffleEntriesTable).values({ raffleId: raffle.id, discordUserId: interaction.user.id, steamId });
  const entries = await db.select().from(raffleEntriesTable).where(eq(raffleEntriesTable.raffleId, raffle.id));
  await updateRaffleMessage(interaction.client, raffle, entries.length);
  await interaction.reply({ content: `🎟️ Participação confirmada! Boa sorte, <@${interaction.user.id}>.`, ephemeral: true });
}

/** Modal antigo não é mais necessário no sorteio VIP, mas o export é mantido para compatibilidade do dispatcher. */
export async function handleRaffleModal(interaction: ModalSubmitInteraction): Promise<void> {
  await interaction.reply({ content: "ℹ️ Este sorteio não exige mais vinculação manual de Steam. Use o botão Participar.", ephemeral: true }).catch(() => {});
}

export async function drawRaffleWinner(client: Client, raffleId: number): Promise<void> {
  await ensureVipRaffleColumns();
  const [raffle] = await db.select().from(rafflesTable).where(eq(rafflesTable.id, raffleId));
  if (!raffle || raffle.status !== "active") return;

  const entries = await db.select().from(raffleEntriesTable).where(eq(raffleEntriesTable.raffleId, raffleId));
  await db.update(rafflesTable).set({ status: "completed" }).where(eq(rafflesTable.id, raffleId));
  const prize = safePrize(raffle.prizeText) || raffle.prizeTier;

  if (!entries.length) {
    await editEndedMessage(client, raffle, prize, null);
    return;
  }

  const winner = entries[Math.floor(Math.random() * entries.length)]!;
  await db.update(rafflesTable).set({
    winnerDiscordId: winner.discordUserId,
    winnerSteamId: winner.steamId,
  }).where(eq(rafflesTable.id, raffleId));

  if (!raffle.vipOnly && raffle.prizeTier in VIP_TIERS && winner.steamId !== "VIP-DISCORD") {
    await grantVip({
      discordUserId: winner.discordUserId,
      steamId: winner.steamId,
      tier: raffle.prizeTier as VipTier,
      durationDays: raffle.prizeDurationDays,
      source: "raffle",
      client,
    }).catch(err => logger.error({ err, raffleId }, "Legacy VIP raffle grant failed"));
  }

  await editEndedMessage(client, raffle, prize, winner.discordUserId);
  const resultText = `🎊 **RESULTADO DO SORTEIO VIP!**\n🏆 Vencedor: <@${winner.discordUserId}>\n🎁 Prêmio: **${prize}**`;
  if (raffle.channelId) {
    const channel = await client.channels.fetch(raffle.channelId).catch(() => null) as TextChannel | null;
    if (channel?.isSendable()) await channel.send(resultText).catch(() => {});
  }
}

export async function checkExpiredRaffles(client: Client): Promise<void> {
  await ensureVipRaffleColumns();
  const now = new Date();
  const expired = await db.select().from(rafflesTable).where(and(eq(rafflesTable.status, "active"), lte(rafflesTable.endsAt, now)));
  for (const raffle of expired) await drawRaffleWinner(client, raffle.id).catch(err => logger.error({ err }, "Startup raffle draw error"));
  const active = await db.select().from(rafflesTable).where(eq(rafflesTable.status, "active"));
  for (const raffle of active) {
    const delay = raffle.endsAt.getTime() - Date.now();
    if (delay > 0) setTimeout(() => void drawRaffleWinner(client, raffle.id), delay);
  }
}

function buildVipRaffleEmbed(id: number, prize: string, entries: number, endsAt: Date): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0xf59e0b)
    .setTitle("🎉 Sorteio VIP — Guerra Fria")
    .setDescription("🔒 **Exclusivo para membros VIP.** Clique em **Participar** para entrar no sorteio.")
    .addFields(
      { name: "🎁 Prêmio", value: `**${prize}**`, inline: false },
      { name: "👥 Participantes", value: `**${entries}**`, inline: true },
      { name: "⏰ Encerra", value: `<t:${Math.floor(endsAt.getTime() / 1000)}:R>`, inline: true },
    )
    .setFooter({ text: `Sorteio VIP #${id} • Guerra Fria` })
    .setTimestamp();
}

function buildRaffleRow() {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("raffle_join").setLabel("🎟️ Participar").setStyle(ButtonStyle.Success),
  );
}

async function updateRaffleMessage(client: Client, raffle: typeof rafflesTable.$inferSelect, entryCount: number): Promise<void> {
  if (!raffle.channelId || !raffle.messageId) return;
  const channel = await client.channels.fetch(raffle.channelId).catch(() => null) as TextChannel | null;
  const message = channel ? await channel.messages.fetch(raffle.messageId).catch(() => null) : null;
  if (!message) return;
  const prize = safePrize(raffle.prizeText) || raffle.prizeTier;
  await message.edit({ embeds: [buildVipRaffleEmbed(raffle.id, prize, entryCount, raffle.endsAt)], components: [buildRaffleRow()] });
}

async function editEndedMessage(client: Client, raffle: typeof rafflesTable.$inferSelect, prize: string, winnerDiscordId: string | null): Promise<void> {
  if (!raffle.channelId || !raffle.messageId) return;
  const channel = await client.channels.fetch(raffle.channelId).catch(() => null) as TextChannel | null;
  const message = channel ? await channel.messages.fetch(raffle.messageId).catch(() => null) : null;
  if (!message) return;
  const embed = new EmbedBuilder()
    .setColor(winnerDiscordId ? 0x22c55e : 0x64748b)
    .setTitle("🏆 Sorteio VIP encerrado")
    .setDescription(winnerDiscordId ? `Vencedor: <@${winnerDiscordId}>\n🎁 **${prize}**` : `Nenhum participante.\n🎁 **${prize}**`)
    .setTimestamp();
  await message.edit({ embeds: [embed], components: [] });
}

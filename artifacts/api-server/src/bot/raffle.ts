import {
  ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ModalBuilder,
  TextInputBuilder, TextInputStyle, type ButtonInteraction, type Client,
  type ModalSubmitInteraction, type TextChannel,
} from "discord.js";
import { eq, and, lte } from "drizzle-orm";
import { db, rafflesTable, raffleEntriesTable, boosterLinksTable } from "@workspace/db";
import { grantVip, VIP_TIERS, type VipTier } from "./vip.js";
import { logger } from "../lib/logger.js";

export async function createRaffle(opts: { client: Client; tier: VipTier; vipDurationDays: number; raffleHours: number; createdBy: string; }): Promise<void> {
  const { client, tier, vipDurationDays, raffleHours, createdBy } = opts;
  const vip = VIP_TIERS[tier]; const endsAt = new Date(Date.now() + raffleHours * 60 * 60 * 1000);
  const [raffle] = await db.insert(rafflesTable).values({ prizeTier: tier, prizeDurationDays: vipDurationDays, endsAt, createdBy, status: "active" }).returning();
  if (!raffle) throw new Error("Failed to create raffle");
  const embed = buildRaffleEmbed(raffle.id, vip.name, vip.emoji, vipDurationDays, 0, endsAt);
  const raffleChannelId = process.env.DISCORD_RAFFLE_CHANNEL_ID;
  if (raffleChannelId) {
    const ch = await client.channels.fetch(raffleChannelId).catch(() => null) as TextChannel | null;
    if (ch) { const msg = await ch.send({ embeds: [embed], components: [buildRaffleRow()] }); await db.update(rafflesTable).set({ messageId: msg.id, channelId: ch.id }).where(eq(rafflesTable.id, raffle.id)); }
  }
  const announcementsChannelId = process.env.DISCORD_ANNOUNCEMENTS_CHANNEL_ID;
  if (announcementsChannelId) {
    const ch = await client.channels.fetch(announcementsChannelId).catch(() => null) as TextChannel | null;
    if (ch) await ch.send(`🎉 **SORTEIO ATIVO!** ${vip.emoji} **${vip.name}** por **${vipDurationDays} dias** está sendo sorteado!\n👉 Acesse <#${raffleChannelId ?? "o canal de sorteios"}> e clique em **Participar**.\n⏰ Encerra em <t:${Math.floor(endsAt.getTime() / 1000)}:R>`);
  }
  const delay = endsAt.getTime() - Date.now(); if (delay > 0) setTimeout(() => drawRaffleWinner(client, raffle.id).catch(err => logger.error({ err }, "Raffle draw error")), delay);
}

async function addEntry(interaction: ButtonInteraction | ModalSubmitInteraction, raffleId: number, steamId: string): Promise<void> {
  const [existing] = await db.select().from(raffleEntriesTable).where(and(eq(raffleEntriesTable.raffleId, raffleId), eq(raffleEntriesTable.discordUserId, interaction.user.id)));
  if (existing) { await interaction.reply({ content: "✅ Você já está participando deste sorteio!", ephemeral: true }); return; }
  const [raffle] = await db.select().from(rafflesTable).where(and(eq(rafflesTable.id, raffleId), eq(rafflesTable.status, "active")));
  if (!raffle) { await interaction.reply({ content: "❌ Sorteio não encontrado ou já encerrado.", ephemeral: true }); return; }
  await db.insert(raffleEntriesTable).values({ raffleId, discordUserId: interaction.user.id, steamId });
  const entries = await db.select().from(raffleEntriesTable).where(eq(raffleEntriesTable.raffleId, raffleId));
  await updateRaffleMessage(interaction.client, raffle, entries.length);
  await interaction.reply({ content: `🎉 **Você está participando!** Boa sorte, <@${interaction.user.id}>!\n🎮 Steam vinculada: \`${steamId}\`\n\n🔒 Para alterar a Steam vinculada, abra um ticket com a administração.`, ephemeral: true });
}

export async function handleRaffleJoin(interaction: ButtonInteraction): Promise<void> {
  const [raffle] = await db.select().from(rafflesTable).where(and(eq(rafflesTable.messageId, interaction.message.id), eq(rafflesTable.status, "active")));
  if (!raffle) { await interaction.reply({ content: "❌ Este sorteio não está mais ativo.", ephemeral: true }); return; }
  const [already] = await db.select().from(raffleEntriesTable).where(and(eq(raffleEntriesTable.raffleId, raffle.id), eq(raffleEntriesTable.discordUserId, interaction.user.id)));
  if (already) { await interaction.reply({ content: "✅ Você já está participando deste sorteio!", ephemeral: true }); return; }
  const [linked] = await db.select().from(boosterLinksTable).where(eq(boosterLinksTable.discordUserId, interaction.user.id)).limit(1);
  if (linked) { await addEntry(interaction, raffle.id, linked.steamId); return; }
  const modal = new ModalBuilder().setCustomId(`raffle_modal_${raffle.id}`).setTitle("Vincular Steam e participar").addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("steam_id").setLabel("Seu SteamID64 — será salvo na conta").setStyle(TextInputStyle.Short).setPlaceholder("76561198XXXXXXXXX").setMinLength(17).setMaxLength(17).setRequired(true))
  );
  await interaction.showModal(modal);
}

export async function handleRaffleModal(interaction: ModalSubmitInteraction): Promise<void> {
  const raffleId = parseInt(interaction.customId.replace("raffle_modal_", ""), 10); if (isNaN(raffleId)) return;
  const steamId = interaction.fields.getTextInputValue("steam_id").trim();
  if (!/^\d{17}$/.test(steamId)) { await interaction.reply({ content: "❌ Steam ID inválido. Deve ter 17 dígitos numéricos.", ephemeral: true }); return; }
  const [discordLink] = await db.select().from(boosterLinksTable).where(eq(boosterLinksTable.discordUserId, interaction.user.id)).limit(1);
  if (discordLink && discordLink.steamId !== steamId) { await interaction.reply({ content: `🔒 Esta conta já possui a Steam \`${discordLink.steamId}\` vinculada. Para alterar, abra um ticket com a administração.`, ephemeral: true }); return; }
  const [steamOwner] = await db.select().from(boosterLinksTable).where(eq(boosterLinksTable.steamId, steamId)).limit(1);
  if (steamOwner && steamOwner.discordUserId !== interaction.user.id) { await interaction.reply({ content: "❌ Este SteamID já está vinculado a outra conta do Discord. Abra um ticket com a administração se acredita que isso é um erro.", ephemeral: true }); return; }
  if (!discordLink) await db.insert(boosterLinksTable).values({ discordUserId: interaction.user.id, steamId, active: false, updatedAt: new Date() });
  await addEntry(interaction, raffleId, steamId);
}

export async function drawRaffleWinner(client: Client, raffleId: number): Promise<void> {
  const [raffle] = await db.select().from(rafflesTable).where(eq(rafflesTable.id, raffleId)); if (!raffle || raffle.status !== "active") return;
  const entries = await db.select().from(raffleEntriesTable).where(eq(raffleEntriesTable.raffleId, raffleId));
  await db.update(rafflesTable).set({ status: "completed" }).where(eq(rafflesTable.id, raffleId));
  if (!entries.length) { if (raffle.channelId && raffle.messageId) { const ch = await client.channels.fetch(raffle.channelId).catch(() => null) as TextChannel | null; const msg = ch ? await ch.messages.fetch(raffle.messageId).catch(() => null) : null; const vip = VIP_TIERS[raffle.prizeTier as VipTier]; if (msg) await msg.edit({ embeds: [buildEndedEmbed(vip.name, vip.emoji, null, raffle.prizeDurationDays)], components: [] }); } return; }
  const winner = entries[Math.floor(Math.random() * entries.length)]!;
  await db.update(rafflesTable).set({ winnerDiscordId: winner.discordUserId, winnerSteamId: winner.steamId }).where(eq(rafflesTable.id, raffleId));
  const vip = VIP_TIERS[raffle.prizeTier as VipTier];
  await grantVip({ discordUserId: winner.discordUserId, steamId: winner.steamId, tier: raffle.prizeTier as VipTier, durationDays: raffle.prizeDurationDays, source: "raffle", client });
  if (raffle.channelId && raffle.messageId) { const ch = await client.channels.fetch(raffle.channelId).catch(() => null) as TextChannel | null; if (ch) { const msg = await ch.messages.fetch(raffle.messageId).catch(() => null); if (msg) await msg.edit({ embeds: [buildEndedEmbed(vip.name, vip.emoji, winner.discordUserId, raffle.prizeDurationDays)], components: [] }); await ch.send(`🎊 **RESULTADO DO SORTEIO!**\n\n🏆 Vencedor: <@${winner.discordUserId}> — **${vip.emoji} ${vip.name}** por **${raffle.prizeDurationDays} dias**.\n🎮 Steam: \`${winner.steamId}\`\n✅ VIP ativado automaticamente.`); } }
}

export async function checkExpiredRaffles(client: Client): Promise<void> {
  const now = new Date(); const expired = await db.select().from(rafflesTable).where(and(eq(rafflesTable.status, "active"), lte(rafflesTable.endsAt, now)));
  for (const raffle of expired) await drawRaffleWinner(client, raffle.id).catch(err => logger.error({ err }, "Startup raffle draw error"));
  const active = await db.select().from(rafflesTable).where(eq(rafflesTable.status, "active"));
  for (const raffle of active) { const delay = raffle.endsAt.getTime() - Date.now(); if (delay > 0) setTimeout(() => drawRaffleWinner(client, raffle.id).catch(err => logger.error({ err }, "Raffle draw error")), delay); }
}

function buildRaffleEmbed(id: number, name: string, emoji: string, days: number, entries: number, endsAt: Date): EmbedBuilder {
  return new EmbedBuilder().setColor(0xf39c12).setTitle(`🎉  SORTEIO — ${emoji} ${name}`)
    .setDescription("Clique em **Participar**. Se você já possui uma Steam vinculada ao Discord, ela será usada automaticamente; caso contrário, o SteamID será solicitado uma única vez.")
    .addFields({ name: "🎁 Prêmio", value: `${emoji} **${name}** por **${days} dias**`, inline: true }, { name: "👥 Participantes", value: `**${entries}**`, inline: true }, { name: "⏰ Encerra em", value: `<t:${Math.floor(endsAt.getTime() / 1000)}:R>`, inline: true })
    .setFooter({ text: `Sorteio #${id} • Guerra Fria` }).setTimestamp();
}
function buildEndedEmbed(name: string, emoji: string, winnerDiscordId: string | null, days: number): EmbedBuilder { return new EmbedBuilder().setColor(winnerDiscordId ? 0x2ecc71 : 0x95a5a6).setTitle(`🏆 Sorteio Encerrado — ${emoji} ${name}`).setDescription(winnerDiscordId ? `O vencedor do **${emoji} ${name}** (${days} dias) foi <@${winnerDiscordId}>! 🎊` : "Nenhum participante — sorteio encerrado sem vencedor.").setTimestamp(); }
function buildRaffleRow() { return new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId("raffle_join").setLabel("🎟️ Participar").setStyle(ButtonStyle.Success)); }
async function updateRaffleMessage(client: Client, raffle: typeof rafflesTable.$inferSelect, entryCount: number): Promise<void> { if (!raffle.channelId || !raffle.messageId) return; const ch = await client.channels.fetch(raffle.channelId).catch(() => null) as TextChannel | null; const msg = ch ? await ch.messages.fetch(raffle.messageId).catch(() => null) : null; if (!msg) return; const vip = VIP_TIERS[raffle.prizeTier as VipTier]; await msg.edit({ embeds: [buildRaffleEmbed(raffle.id, vip.name, vip.emoji, raffle.prizeDurationDays, entryCount, raffle.endsAt)], components: [buildRaffleRow()] }); }

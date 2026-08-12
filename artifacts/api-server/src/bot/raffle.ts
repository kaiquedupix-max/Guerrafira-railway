import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type Client,
  type ModalSubmitInteraction,
  type TextChannel,
} from "discord.js";
import { eq, and, lte, inArray } from "drizzle-orm";
import { db, rafflesTable, raffleEntriesTable } from "@workspace/db";
import { grantVip, VIP_TIERS, type VipTier } from "./vip.js";
import { logger } from "../lib/logger.js";

// ─── Create & announce raffle ─────────────────────────────────────────────────
export async function createRaffle(opts: {
  client: Client;
  tier: VipTier;
  vipDurationDays: number;
  raffleHours: number;
  createdBy: string;
}): Promise<void> {
  const { client, tier, vipDurationDays, raffleHours, createdBy } = opts;
  const vip     = VIP_TIERS[tier];
  const endsAt  = new Date(Date.now() + raffleHours * 60 * 60 * 1000);

  // Insert raffle record
  const [raffle] = await db
    .insert(rafflesTable)
    .values({ prizeTier: tier, prizeDurationDays: vipDurationDays, endsAt, createdBy, status: "active" })
    .returning();

  if (!raffle) throw new Error("Failed to create raffle");

  const embed = buildRaffleEmbed(raffle.id, vip.name, vip.emoji, vipDurationDays, 0, endsAt);
  const row   = buildRaffleRow();

  // Post in raffle channel
  const raffleChannelId = process.env.DISCORD_RAFFLE_CHANNEL_ID;
  if (raffleChannelId) {
    const ch = await client.channels.fetch(raffleChannelId).catch(() => null) as TextChannel | null;
    if (ch) {
      const msg = await ch.send({ embeds: [embed], components: [row] });
      await db.update(rafflesTable)
        .set({ messageId: msg.id, channelId: ch.id })
        .where(eq(rafflesTable.id, raffle.id));
    }
  }

  // Ping in announcements channel
  const announcementsChannelId = process.env.DISCORD_ANNOUNCEMENTS_CHANNEL_ID;
  if (announcementsChannelId) {
    const ch = await client.channels.fetch(announcementsChannelId).catch(() => null) as TextChannel | null;
    if (ch) {
      await ch.send(
        `🎉 **SORTEIO ATIVO!** ${vip.emoji} **${vip.name}** por **${vipDurationDays} dias** está sendo sorteado!\n` +
        `👉 Acesse <#${raffleChannelId ?? "o canal de sorteios"}> e clique em **Participar** para concorrer!\n` +
        `⏰ Encerra em <t:${Math.floor(endsAt.getTime() / 1000)}:R>`,
      );
    }
  }

  // Schedule auto-draw
  const delay = endsAt.getTime() - Date.now();
  if (delay > 0) {
    setTimeout(() => drawRaffleWinner(client, raffle.id).catch((err) => logger.error({ err }, "Raffle draw error")), delay);
  }

  logger.info({ raffleId: raffle.id, tier, vipDurationDays, raffleHours }, "Raffle created");
}

// ─── Join raffle — button clicked ────────────────────────────────────────────
export async function handleRaffleJoin(interaction: ButtonInteraction): Promise<void> {
  // Find active raffle for this message
  const [raffle] = await db
    .select()
    .from(rafflesTable)
    .where(and(eq(rafflesTable.messageId, interaction.message.id), eq(rafflesTable.status, "active")));

  if (!raffle) {
    await interaction.reply({ content: "❌ Este sorteio não está mais ativo.", ephemeral: true });
    return;
  }

  // Check if already entered
  const [existing] = await db
    .select()
    .from(raffleEntriesTable)
    .where(and(eq(raffleEntriesTable.raffleId, raffle.id), eq(raffleEntriesTable.discordUserId, interaction.user.id)));

  if (existing) {
    await interaction.reply({ content: "✅ Você já está participando deste sorteio!", ephemeral: true });
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId(`raffle_modal_${raffle.id}`)
    .setTitle("Participar do Sorteio")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("steam_id")
          .setLabel("Seu Steam ID (SteamID64)")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("76561198XXXXXXXXX")
          .setRequired(true),
      ),
    );

  await interaction.showModal(modal);
}

// ─── Join raffle — modal submitted ───────────────────────────────────────────
export async function handleRaffleModal(interaction: ModalSubmitInteraction): Promise<void> {
  const raffleIdStr = interaction.customId.replace("raffle_modal_", "");
  const raffleId    = parseInt(raffleIdStr, 10);
  if (isNaN(raffleId)) return;

  const steamId = interaction.fields.getTextInputValue("steam_id").trim();
  if (!/^\d{17}$/.test(steamId)) {
    await interaction.reply({ content: "❌ Steam ID inválido. Deve ter 17 dígitos numéricos (ex: 76561198XXXXXXXXX).", ephemeral: true });
    return;
  }

  const [raffle] = await db
    .select()
    .from(rafflesTable)
    .where(and(eq(rafflesTable.id, raffleId), eq(rafflesTable.status, "active")));

  if (!raffle) {
    await interaction.reply({ content: "❌ Sorteio não encontrado ou já encerrado.", ephemeral: true });
    return;
  }

  // Prevent duplicate entry
  const [existing] = await db
    .select()
    .from(raffleEntriesTable)
    .where(and(eq(raffleEntriesTable.raffleId, raffleId), eq(raffleEntriesTable.discordUserId, interaction.user.id)));

  if (existing) {
    await interaction.reply({ content: "✅ Você já está participando deste sorteio!", ephemeral: true });
    return;
  }

  await db.insert(raffleEntriesTable).values({
    raffleId,
    discordUserId: interaction.user.id,
    steamId,
  });

  // Count entries and update raffle message
  const entries = await db.select().from(raffleEntriesTable).where(eq(raffleEntriesTable.raffleId, raffleId));
  await updateRaffleMessage(interaction.client, raffle, entries.length);

  await interaction.reply({
    content: `🎉 **Você está participando!** Boa sorte, <@${interaction.user.id}>!\n📋 Steam ID registrado: \`${steamId}\``,
    ephemeral: true,
  });

  logger.info({ raffleId, discordUserId: interaction.user.id, steamId }, "Raffle entry added");
}

// ─── Draw winner ──────────────────────────────────────────────────────────────
export async function drawRaffleWinner(client: Client, raffleId: number): Promise<void> {
  const [raffle] = await db.select().from(rafflesTable).where(eq(rafflesTable.id, raffleId));
  if (!raffle || raffle.status !== "active") return;

  const entries = await db.select().from(raffleEntriesTable).where(eq(raffleEntriesTable.raffleId, raffleId));

  // Mark raffle as completed first (idempotency)
  await db.update(rafflesTable).set({ status: "completed" }).where(eq(rafflesTable.id, raffleId));

  if (entries.length === 0) {
    // No participants
    if (raffle.channelId && raffle.messageId) {
      const ch = await client.channels.fetch(raffle.channelId).catch(() => null) as TextChannel | null;
      if (ch) {
        const msg = await ch.messages.fetch(raffle.messageId).catch(() => null);
        const vip = VIP_TIERS[raffle.prizeTier as VipTier];
        if (msg) await msg.edit({ embeds: [buildEndedEmbed(vip.name, vip.emoji, null, raffle.prizeDurationDays)], components: [] });
      }
    }
    return;
  }

  // Pick random winner
  const winner = entries[Math.floor(Math.random() * entries.length)]!;

  await db.update(rafflesTable).set({ winnerDiscordId: winner.discordUserId, winnerSteamId: winner.steamId }).where(eq(rafflesTable.id, raffleId));

  const vip = VIP_TIERS[raffle.prizeTier as VipTier];

  // Grant VIP to winner
  await grantVip({
    discordUserId: winner.discordUserId,
    steamId: winner.steamId,
    tier: raffle.prizeTier as VipTier,
    durationDays: raffle.prizeDurationDays,
    source: "raffle",
    client,
  });

  // Update raffle message
  if (raffle.channelId && raffle.messageId) {
    const ch = await client.channels.fetch(raffle.channelId).catch(() => null) as TextChannel | null;
    if (ch) {
      const msg = await ch.messages.fetch(raffle.messageId).catch(() => null);
      if (msg) await msg.edit({ embeds: [buildEndedEmbed(vip.name, vip.emoji, winner.discordUserId, raffle.prizeDurationDays)], components: [] });

      await ch.send(
        `🎊 **RESULTADO DO SORTEIO!**\n\n` +
        `🏆 O vencedor do **${vip.emoji} ${vip.name}** por **${raffle.prizeDurationDays} dias** é: <@${winner.discordUserId}>!\n` +
        `🎮 Steam ID: \`${winner.steamId}\`\n\n` +
        `Parabéns! Seu VIP foi ativado automaticamente no servidor e no Discord. ✅`,
      );
    }
  }

  logger.info({ raffleId, winnerId: winner.discordUserId, steamId: winner.steamId, tier: raffle.prizeTier }, "Raffle winner drawn");
}

// ─── Check for expired raffles on startup ────────────────────────────────────
export async function checkExpiredRaffles(client: Client): Promise<void> {
  const now     = new Date();
  const expired = await db
    .select()
    .from(rafflesTable)
    .where(and(eq(rafflesTable.status, "active"), lte(rafflesTable.endsAt, now)));

  for (const raffle of expired) {
    await drawRaffleWinner(client, raffle.id).catch((err) =>
      logger.error({ err, raffleId: raffle.id }, "Startup raffle draw error"),
    );
  }

  // Schedule still-active raffles
  const active = await db.select().from(rafflesTable).where(eq(rafflesTable.status, "active"));
  for (const raffle of active) {
    const delay = raffle.endsAt.getTime() - Date.now();
    if (delay > 0) {
      setTimeout(() => drawRaffleWinner(client, raffle.id).catch((err) => logger.error({ err }, "Raffle draw error")), delay);
    }
  }
}

// ─── Embed builders ───────────────────────────────────────────────────────────
function buildRaffleEmbed(id: number, name: string, emoji: string, days: number, entries: number, endsAt: Date): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0xf39c12)
    .setTitle(`🎉  SORTEIO — ${emoji} ${name}`)
    .setDescription("Clique em **Participar** para entrar no sorteio! Preencha seu Steam ID para que o prêmio seja ativado automaticamente.")
    .addFields(
      { name: "🎁 Prêmio",       value: `${emoji} **${name}** por **${days} dias**`, inline: true },
      { name: "👥 Participantes", value: `**${entries}**`, inline: true },
      { name: "⏰ Encerra em",    value: `<t:${Math.floor(endsAt.getTime() / 1000)}:R>`, inline: true },
    )
    .setFooter({ text: `Sorteio #${id} • Guerra Fria` })
    .setTimestamp();
}

function buildEndedEmbed(name: string, emoji: string, winnerDiscordId: string | null, days: number): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(winnerDiscordId ? 0x2ecc71 : 0x95a5a6)
    .setTitle(`🏆  Sorteio Encerrado — ${emoji} ${name}`)
    .setDescription(
      winnerDiscordId
        ? `O vencedor do **${emoji} ${name}** (${days} dias) foi <@${winnerDiscordId}>! 🎊`
        : "Nenhum participante — sorteio encerrado sem vencedor.",
    )
    .setFooter({ text: "Guerra Fria • Sorteio Encerrado" })
    .setTimestamp();
}

function buildRaffleRow(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("raffle_join")
      .setLabel("🎟️  Participar")
      .setStyle(ButtonStyle.Success),
  );
}

async function updateRaffleMessage(client: Client, raffle: typeof rafflesTable.$inferSelect, entryCount: number): Promise<void> {
  if (!raffle.channelId || !raffle.messageId) return;
  const ch = await client.channels.fetch(raffle.channelId).catch(() => null) as TextChannel | null;
  if (!ch) return;
  const msg = await ch.messages.fetch(raffle.messageId).catch(() => null);
  if (!msg) return;

  const vip = VIP_TIERS[raffle.prizeTier as VipTier];
  const embed = buildRaffleEmbed(raffle.id, vip.name, vip.emoji, raffle.prizeDurationDays, entryCount, raffle.endsAt);
  await msg.edit({ embeds: [embed], components: [buildRaffleRow()] }).catch(() => {});
}

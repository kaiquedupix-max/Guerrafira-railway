import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
} from "discord.js";
import { db, playerStatsTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../../lib/logger.js";

export const data = new SlashCommandBuilder()
  .setName("resetleaderboard")
  .setDescription("Reseta todas as estatísticas do leaderboard (kills, KD, HS, farm, explosivos).")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  // Ask for confirmation before wiping all stats
  const embed = new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle("⚠️  Confirmar Reset do Leaderboard")
    .setDescription(
      "Isso vai **zerar todas as estatísticas** de todos os jogadores:\n\n" +
      "• 🔫 Kills\n• 💀 Mortes\n• 🎯 Headshots\n• ⛏️ Farm\n• 💣 Explosivos craftados\n\n" +
      "**Essa ação não pode ser desfeita.** Deseja continuar?",
    )
    .setFooter({ text: `Solicitado por ${interaction.user.tag}` })
    .setTimestamp();

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`rlb_confirm:${interaction.user.id}`)
      .setLabel("✅  Sim, resetar agora")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId("rlb_cancel")
      .setLabel("❌  Cancelar")
      .setStyle(ButtonStyle.Secondary),
  );

  await interaction.reply({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });
}

// ─── Button: confirm ──────────────────────────────────────────────────────────
export async function handleConfirm(interaction: ButtonInteraction): Promise<void> {
  // Only the admin who ran the command can confirm
  const requesterId = interaction.customId.split(":")[1];
  if (interaction.user.id !== requesterId) {
    await interaction.reply({ content: "❌ Só quem usou o comando pode confirmar.", flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferUpdate();

  // Zero all stats (keep player rows so names/steamids are preserved)
  await db.update(playerStatsTable).set({
    kills:             0,
    deaths:            0,
    headshots:         0,
    resourcesGathered: 0,
    woodGathered:      0,
    stoneGathered:     0,
    metalOreGathered:  0,
    sulfurOreGathered: 0,
    scrapGathered:     0,
    explosivesCrafted: 0,
    gunpowderCrafted:  0,
    c4Used:            0,
    rocketsUsed:       0,
    updatedAt:         sql`now()`,
  });

  logger.info({ admin: interaction.user.tag }, "Leaderboard reset by admin");

  // Refresh leaderboard channel immediately
  try {
    const { refreshLeaderboardChannel } = await import("../leaderboardChannel.js");
    await refreshLeaderboardChannel(interaction.client);
  } catch { /* non-critical */ }

  // Log to mod log channel
  const logChannelId = process.env.DISCORD_LOG_CHANNEL_ID;
  if (logChannelId) {
    const ch = await interaction.client.channels.fetch(logChannelId).catch(() => null);
    if (ch?.isSendable()) {
      await ch.send({
        embeds: [
          new EmbedBuilder()
            .setColor(0xe74c3c)
            .setTitle("🔄  Leaderboard Resetado")
            .setDescription(`Todas as estatísticas foram zeradas por <@${interaction.user.id}>.`)
            .setFooter({ text: interaction.user.tag })
            .setTimestamp(),
        ],
      });
    }
  }

  const done = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle("✅  Leaderboard Resetado")
    .setDescription("Todas as estatísticas foram zeradas com sucesso.\nO canal de leaderboard foi atualizado.")
    .setTimestamp();

  await interaction.editReply({ embeds: [done], components: [] });
}

// ─── Button: cancel ───────────────────────────────────────────────────────────
export async function handleCancel(interaction: ButtonInteraction): Promise<void> {
  await interaction.update({
    embeds: [
      new EmbedBuilder()
        .setColor(0x95a5a6)
        .setTitle("❌  Cancelado")
        .setDescription("O reset do leaderboard foi cancelado."),
    ],
    components: [],
  });
}

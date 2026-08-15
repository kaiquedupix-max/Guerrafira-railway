import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  type ChatInputCommandInteraction,
  type AutocompleteInteraction,
} from "discord.js";
import {
  searchPlayers,
  getPlayerBySteamId,
} from "../utils/players.js";
import { executeRconCommand } from "../utils/rcon.js";
import { db, modLogsTable } from "@workspace/db";
import { ActionError, kickPlayer } from "../../core/systemActions.js";

const APPEAL_LINK = "discord.gg/guerrafria";

export const data = new SlashCommandBuilder()
  .setName("kickar")
  .setDescription("Expulsa um jogador online do servidor")
  .addStringOption((opt) =>
    opt
      .setName("jogador")
      .setDescription("Nome do jogador a ser expulso")
      .setRequired(true)
      .setAutocomplete(true)
  )
  .addStringOption((opt) =>
    opt
      .setName("motivo")
      .setDescription("Motivo da expulsão")
      .setRequired(true)
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers);

export async function autocomplete(
  interaction: AutocompleteInteraction
): Promise<void> {
  const focused = interaction.options.getFocused();
  const players = await searchPlayers(focused, 25);
  await interaction.respond(
    players.map((p) => ({
      name: `${p.isOnline ? "🟢" : "⚫"} ${p.playerName} — ${p.steamId}`,
      value: p.steamId,
    }))
  );
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const result = await kickPlayer({
      steamId: interaction.options.getString("jogador", true),
      reason: interaction.options.getString("motivo", true),
      actor: { id: interaction.user.id, name: interaction.user.tag, source: "discord" },
    });
    await interaction.editReply(`✅ **${result.playerName}** foi expulso com confirmação do servidor.`);
  } catch (error) {
    await interaction.editReply(`❌ ${error instanceof ActionError ? error.message : "Falha interna ao expulsar o jogador."}`);
  }
}

import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  type ChatInputCommandInteraction,
  type AutocompleteInteraction,
} from "discord.js";
import { searchPlayers, getPlayerBySteamId } from "../utils/players.js";
import { buildVerifyEmbed } from "../utils/embeds.js";
import { executeRconCommand } from "../utils/rcon.js";
import { db, modLogsTable } from "@workspace/db";
import { ActionError, verifyPlayer } from "../../core/systemActions.js";

export const data = new SlashCommandBuilder()
  .setName("verificar")
  .setDescription("Verifica um jogador e concede Verificado no Discord e no Rust")
  .addStringOption((opt) => opt.setName("jogador").setDescription("Nome do jogador no servidor (busca pelo nome ou Steam ID)").setRequired(true).setAutocomplete(true))
  .addUserOption((opt) => opt.setName("membro").setDescription("Membro do Discord para receber o cargo Verificado").setRequired(true))
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles);

export async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const focused = interaction.options.getFocused();
  const players = await searchPlayers(focused, 25);
  await interaction.respond(players.map((p) => ({ name: `${p.isOnline ? "🟢" : "⚫"} ${p.playerName} — ${p.steamId}`, value: p.steamId })));
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const discordUser = interaction.options.getUser("membro", true);
    const result = await verifyPlayer({
      steamId: interaction.options.getString("jogador", true),
      discordUserId: discordUser.id,
      actor: { id: interaction.user.id, name: interaction.user.tag, source: "discord" },
    });
    await interaction.editReply(`✅ **${result.playerName}** foi verificado no Rust e no Discord.`);
  } catch (error) {
    await interaction.editReply(`❌ ${error instanceof ActionError ? error.message : "Falha interna na verificação."}`);
  }
}

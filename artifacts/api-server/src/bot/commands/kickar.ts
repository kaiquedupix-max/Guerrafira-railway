import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  type ChatInputCommandInteraction,
  type AutocompleteInteraction,
} from "discord.js";
import { searchPlayers } from "../utils/players.js";
import { ActionError, kickPlayer } from "../../core/systemActions.js";

const ANONYMOUS_MODERATOR_ROLE_ID = "1538735197611360347";
const ANONYMOUS_MODERATOR_LABEL = "Equipe de Moderação";

async function moderationActor(interaction: ChatInputCommandInteraction) {
  const member = interaction.guild ? await interaction.guild.members.fetch(interaction.user.id).catch(() => null) : null;
  const anonymous = member?.roles.cache.has(ANONYMOUS_MODERATOR_ROLE_ID) ?? false;
  return anonymous
    ? { id: interaction.user.id, name: ANONYMOUS_MODERATOR_LABEL, source: "system" as const }
    : { id: interaction.user.id, name: interaction.user.tag, source: "discord" as const };
}

export const data = new SlashCommandBuilder()
  .setName("kickar").setDescription("Expulsa um jogador online do servidor")
  .addStringOption(opt => opt.setName("jogador").setDescription("Nome do jogador a ser expulso").setRequired(true).setAutocomplete(true))
  .addStringOption(opt => opt.setName("motivo").setDescription("Motivo da expulsão").setRequired(true))
  .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers);

export async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const focused = interaction.options.getFocused();
  const players = await searchPlayers(focused, 25);
  await interaction.respond(players.map(p => ({ name: `${p.isOnline ? "🟢" : "⚫"} ${p.playerName} — ${p.steamId}`, value: p.steamId })));
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const result = await kickPlayer({
      steamId: interaction.options.getString("jogador", true),
      reason: interaction.options.getString("motivo", true),
      actor: await moderationActor(interaction),
    });
    await interaction.editReply(`✅ **${result.playerName}** foi expulso com confirmação do servidor.`);
  } catch (error) {
    await interaction.editReply(`❌ ${error instanceof ActionError ? error.message : "Falha interna ao expulsar o jogador."}`);
  }
}

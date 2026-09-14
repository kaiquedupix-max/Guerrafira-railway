import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  type ChatInputCommandInteraction,
  type AutocompleteInteraction,
} from "discord.js";
import { searchPlayers } from "../utils/players.js";
import { executeRconCommand } from "../utils/rcon.js";
import { ActionError, verifyPlayer } from "../../core/systemActions.js";

const ANONYMOUS_MODERATOR_ROLE_ID = "1538735197611360347";
const ANONYMOUS_MODERATOR_LABEL = "Equipe de Moderação";

async function moderationActor(interaction: ChatInputCommandInteraction) {
  const member = interaction.guild ? await interaction.guild.members.fetch(interaction.user.id).catch(() => null) : null;
  const anonymous = member?.roles.cache.has(ANONYMOUS_MODERATOR_ROLE_ID) ?? false;
  const displayName = member?.displayName?.trim() || interaction.user.globalName?.trim() || interaction.user.username?.trim() || "Administrador";
  return anonymous
    ? { id: interaction.user.id, name: ANONYMOUS_MODERATOR_LABEL, source: "system" as const }
    : { id: interaction.user.id, name: displayName, source: "discord" as const };
}

export const data = new SlashCommandBuilder()
  .setName("verificar")
  .setDescription("Verifica um jogador, concede Verificado e encerra a telagem ativa")
  .addStringOption(opt => opt.setName("jogador").setDescription("Nome do jogador no servidor (busca pelo nome ou Steam ID)").setRequired(true).setAutocomplete(true))
  .addUserOption(opt => opt.setName("membro").setDescription("Membro do Discord para receber o cargo Verificado").setRequired(true))
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles);

export async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const focused = interaction.options.getFocused();
  const players = await searchPlayers(focused, 25);
  await interaction.respond(players.map(p => ({ name: `${p.isOnline ? "🟢" : "⚫"} ${p.playerName} — ${p.steamId}`, value: p.steamId })));
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const discordUser = interaction.options.getUser("membro", true);
    const steamId = interaction.options.getString("jogador", true).trim();

    const result = await verifyPlayer({
      steamId,
      discordUserId: discordUser.id,
      actor: await moderationActor(interaction),
    });

    // Se o jogador estiver preso em uma sessão do plugin Verificacao,
    // encerra a sessão após a verificação ter sido concluída com sucesso.
    const releaseResult = await executeRconCommand(`verificacao liberar ${steamId}`);
    const releaseMessage = releaseResult === null
      ? "\n⚠️ O jogador foi verificado, mas o servidor não confirmou a liberação da telagem."
      : "\n🔓 A telagem no servidor também foi encerrada e o jogador foi liberado.";

    await interaction.editReply(`✅ **${result.playerName}** foi verificado no Rust e no Discord.${releaseMessage}`);
  } catch (error) {
    await interaction.editReply(`❌ ${error instanceof ActionError ? error.message : "Falha interna na verificação."}`);
  }
}

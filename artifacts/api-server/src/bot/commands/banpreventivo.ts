import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  type ChatInputCommandInteraction,
  type AutocompleteInteraction,
} from "discord.js";
import { searchPlayers } from "../utils/players.js";
import { ActionError, preventiveBanPlayer } from "../../core/systemActions.js";

const STEAM_ID_RE = /^7656119\d{10}$/;
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
  .setName("banpreventivo").setDescription("Aplica banimento preventivo até verificação administrativa")
  .addStringOption(opt => opt.setName("jogador").setDescription("Pesquise pelo nome ou informe o SteamID64").setRequired(true).setAutocomplete(true))
  .addStringOption(opt => opt.setName("motivo").setDescription("Motivo do banimento preventivo").setRequired(true))
  .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers);

export async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const focused = interaction.options.getFocused().trim();
  const players = await searchPlayers(focused, 25);
  const suggestions = players.map(p => ({ name: `${p.isOnline ? "🟢 ONLINE" : "⚫ OFFLINE"} • ${p.playerName} — ${p.steamId}`.slice(0,100), value: p.steamId }));
  if (STEAM_ID_RE.test(focused) && !suggestions.some(s => s.value === focused)) suggestions.unshift({ name: `🛡️ PREVENTIVO • SteamID ${focused}`.slice(0,100), value: focused });
  await interaction.respond(suggestions.slice(0,25));
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const result = await preventiveBanPlayer({
      steamId: interaction.options.getString("jogador", true).trim(),
      reason: interaction.options.getString("motivo", true),
      actor: await moderationActor(interaction),
    });
    await interaction.editReply(`🛡️ **${result.playerName}** foi banido preventivamente.\nO bloqueio permanece até revisão manual. Ao tentar entrar, o jogador será orientado a acessar **discord.gg/guerrafria** e abrir um ticket para **verificação**.`);
  } catch (error) {
    await interaction.editReply(`❌ ${error instanceof ActionError ? error.message : "Falha interna ao aplicar o banimento preventivo."}`);
  }
}

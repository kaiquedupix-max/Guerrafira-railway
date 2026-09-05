import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  type ChatInputCommandInteraction,
  type AutocompleteInteraction,
} from "discord.js";
import { searchPlayers } from "../utils/players.js";
import { ActionError, banPlayer, type BanDuration } from "../../core/systemActions.js";

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
  .setName("banir")
  .setDescription("Bane um jogador do servidor (online ou offline)")
  .addStringOption(opt => opt.setName("jogador").setDescription("Pesquise pelo nome ou informe o SteamID64").setRequired(true).setAutocomplete(true))
  .addStringOption(opt => opt.setName("duracao").setDescription("Duração do banimento").setRequired(true).addChoices(
    { name: "3 Dias", value: "3d" }, { name: "7 Dias", value: "7d" }, { name: "30 Dias", value: "30d" }, { name: "Permanente", value: "perm" }
  ))
  .addStringOption(opt => opt.setName("motivo").setDescription("Motivo do banimento").setRequired(true))
  .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers);

export async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const focused = interaction.options.getFocused().trim();
  const players = await searchPlayers(focused, 25);
  const suggestions = players.map(p => ({ name: `${p.isOnline ? "🟢 ONLINE" : "⚫ OFFLINE"} • ${p.playerName} — ${p.steamId}`.slice(0,100), value: p.steamId }));
  if (STEAM_ID_RE.test(focused) && !suggestions.some(s => s.value === focused)) suggestions.unshift({ name: `⚫ OFFLINE • Banir diretamente SteamID ${focused}`.slice(0,100), value: focused });
  await interaction.respond(suggestions.slice(0,25));
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const duration = interaction.options.getString("duracao", true) as BanDuration;
    const result = await banPlayer({
      steamId: interaction.options.getString("jogador", true).trim(),
      duration,
      reason: interaction.options.getString("motivo", true),
      actor: await moderationActor(interaction),
    });
    const expiry = result.expiresAt ? `\n📅 Expira: <t:${Math.floor(result.expiresAt.getTime()/1000)}:F>` : "\n📅 Banimento permanente";
    await interaction.editReply(`✅ **${result.playerName}** foi banido com confirmação do servidor.${expiry}`);
  } catch (error) {
    await interaction.editReply(`❌ ${error instanceof ActionError ? error.message : "Falha interna ao aplicar o banimento."}`);
  }
}

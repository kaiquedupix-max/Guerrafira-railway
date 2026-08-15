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
import { buildBanEmbed } from "../utils/embeds.js";
import { db, modLogsTable } from "@workspace/db";
import { ActionError, banPlayer, type BanDuration } from "../../core/systemActions.js";

const APPEAL_LINK = "discord.gg/guerrafria";
const STEAM_ID_RE = /^7656119\d{10}$/;

function calcExpiry(duration: string): Date | null {
  const now = new Date();
  switch (duration) {
    case "3d":  return new Date(now.getTime() + 3  * 24 * 60 * 60 * 1000);
    case "7d":  return new Date(now.getTime() + 7  * 24 * 60 * 60 * 1000);
    case "30d": return new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    default:    return null;
  }
}

function durationLabel(duration: string): string {
  switch (duration) {
    case "3d":   return "3 dias";
    case "7d":   return "7 dias";
    case "30d":  return "30 dias";
    case "perm": return "permanente";
    default:     return duration;
  }
}

export const data = new SlashCommandBuilder()
  .setName("banir")
  .setDescription("Bane um jogador do servidor (online ou offline)")
  .addStringOption((opt) =>
    opt
      .setName("jogador")
      .setDescription("Pesquise pelo nome ou informe o SteamID64")
      .setRequired(true)
      .setAutocomplete(true)
  )
  .addStringOption((opt) =>
    opt
      .setName("duracao")
      .setDescription("Duração do banimento")
      .setRequired(true)
      .addChoices(
        { name: "3 Dias",      value: "3d" },
        { name: "7 Dias",      value: "7d" },
        { name: "30 Dias",     value: "30d" },
        { name: "Permanente",  value: "perm" },
      )
  )
  .addStringOption((opt) =>
    opt
      .setName("motivo")
      .setDescription("Motivo do banimento")
      .setRequired(true)
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers);

export async function autocomplete(
  interaction: AutocompleteInteraction
): Promise<void> {
  const focused = interaction.options.getFocused().trim();
  const players = await searchPlayers(focused, 25);

  const suggestions = players.map((p) => ({
    name: `${p.isOnline ? "🟢 ONLINE" : "⚫ OFFLINE"} • ${p.playerName} — ${p.steamId}`.slice(0, 100),
    value: p.steamId,
  }));

  if (STEAM_ID_RE.test(focused) && !suggestions.some((s) => s.value === focused)) {
    suggestions.unshift({
      name: `⚫ OFFLINE • Banir diretamente SteamID ${focused}`.slice(0, 100),
      value: focused,
    });
  }

  await interaction.respond(suggestions.slice(0, 25));
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const duration = interaction.options.getString("duracao", true) as BanDuration;
    const result = await banPlayer({
      steamId: interaction.options.getString("jogador", true).trim(),
      duration,
      reason: interaction.options.getString("motivo", true),
      actor: { id: interaction.user.id, name: interaction.user.tag, source: "discord" },
    });
    const expiry = result.expiresAt ? `\n📅 Expira: <t:${Math.floor(result.expiresAt.getTime()/1000)}:F>` : "\n📅 Banimento permanente";
    await interaction.editReply(`✅ **${result.playerName}** foi banido com confirmação do servidor.${expiry}`);
  } catch (error) {
    await interaction.editReply(`❌ ${error instanceof ActionError ? error.message : "Falha interna ao aplicar o banimento."}`);
  }
}

import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  type ChatInputCommandInteraction,
  type AutocompleteInteraction,
} from "discord.js";
import { db, modLogsTable } from "@workspace/db";
import { searchPlayers, getPlayerBySteamId } from "../utils/players.js";
import { ActionError, executeRconRequired } from "../../core/systemActions.js";

const STEAM_ID_RE = /^7656119\d{10}$/;
const DURATION_RE = /^(?=.+)(?:\d+d)?(?:\d+h)?(?:\d+m)?(?:\d+s)?$/i;
const ANONYMOUS_MODERATOR_ROLE_ID = "1538735197611360347";
const ANONYMOUS_MODERATOR_LABEL = "Moderador do servidor";

function safe(value: string, max = 180): string {
  return String(value ?? "").replace(/[\r\n\t"]/g, " ").trim().slice(0, max);
}
function safeChat(value: string, max = 160): string { return safe(value, max).replace(/[<>]/g, ""); }
function durationLabel(value: string): string {
  return value.replace(/(\d+)d/gi, "$1d ").replace(/(\d+)h/gi, "$1h ").replace(/(\d+)m/gi, "$1min ").replace(/(\d+)s/gi, "$1s ").trim();
}
async function moderatorName(interaction: ChatInputCommandInteraction): Promise<string> {
  const member = interaction.guild ? await interaction.guild.members.fetch(interaction.user.id).catch(() => null) : null;
  return member?.roles.cache.has(ANONYMOUS_MODERATOR_ROLE_ID) ? ANONYMOUS_MODERATOR_LABEL : interaction.user.tag;
}

export const data = new SlashCommandBuilder()
  .setName("mute").setDescription("Muta um jogador do chat do servidor por um período")
  .addStringOption(opt => opt.setName("jogador").setDescription("Pesquise pelo nome ou informe o SteamID64").setRequired(true).setAutocomplete(true))
  .addStringOption(opt => opt.setName("tempo").setDescription("Tempo do mute. Ex.: 30m, 2h, 1d, 1d12h").setRequired(true))
  .addStringOption(opt => opt.setName("motivo").setDescription("Motivo do mute").setRequired(true))
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers);

export async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const focused = interaction.options.getFocused().trim();
  const players = await searchPlayers(focused, 25);
  const suggestions = players.map(p => ({ name: `${p.isOnline ? "🟢 ONLINE" : "⚫ OFFLINE"} • ${p.playerName} — ${p.steamId}`.slice(0,100), value: p.steamId }));
  if (STEAM_ID_RE.test(focused) && !suggestions.some(s => s.value === focused)) suggestions.unshift({ name: `SteamID ${focused}`.slice(0,100), value: focused });
  await interaction.respond(suggestions.slice(0,25));
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const steamId = interaction.options.getString("jogador", true).trim();
    const duration = interaction.options.getString("tempo", true).trim().toLowerCase();
    const reason = safe(interaction.options.getString("motivo", true), 300);
    if (!STEAM_ID_RE.test(steamId)) throw new ActionError("SteamID inválido.");
    if (!DURATION_RE.test(duration) || !/\d/.test(duration)) throw new ActionError("Tempo inválido. Use, por exemplo: 30m, 2h, 1d ou 1d12h.");
    if (!reason) throw new ActionError("Motivo obrigatório.");
    const player = await getPlayerBySteamId(steamId);
    const playerName = safe(player?.playerName || `Jogador (${steamId})`, 100);
    const adminName = await moderatorName(interaction);
    const template = process.env.MUTE_RCON_COMMAND?.trim() || 'bcm.mute {steamid} {duration} "{reason}"';
    const command = template.replace(/\{steamid\}/gi, steamId).replace(/\{duration\}/gi, duration).replace(/\{reason\}/gi, safe(reason,180));
    await executeRconRequired(command);
    await db.insert(modLogsTable).values({ action:"MUTE", steamId, playerName, reason:`${reason} | Duração: ${duration}`, adminId:interaction.user.id, adminName, banDuration:duration });
    await executeRconRequired(`say <color=#FFB000>[JOGADOR MUTADO]</color> | <color=#FF8800>${safeChat(playerName,80)}</color> foi mutado pelo administrador <color=#FF4444>${safeChat(adminName,60)}</color>. <color=#FFD166>Tempo:</color> <color=#FFFFFF>${safeChat(durationLabel(duration),40)}</color> | <color=#FFD166>Motivo:</color> <color=#FFFFFF>${safeChat(reason,140)}</color>`).catch(() => null);
    await interaction.editReply(`✅ **${playerName}** foi mutado por **${durationLabel(duration)}**.\n📝 Motivo: ${reason}`);
  } catch(error) {
    await interaction.editReply(`❌ ${error instanceof ActionError ? error.message : "Falha interna ao mutar o jogador."}`);
  }
}

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
import { sendHostConsoleCommand } from "../../core/hostConsole.js";

const STEAM_ID_RE = /^7656119\d{10}$/;
const ANONYMOUS_MODERATOR_ROLE_ID = "1538735197611360347";
const ANONYMOUS_MODERATOR_LABEL = "Moderador do servidor";

const MUTE_DURATIONS = [
  { name: "10 minutos", value: "10m" },
  { name: "30 minutos", value: "30m" },
  { name: "1 hora", value: "1h" },
  { name: "2 horas", value: "2h" },
  { name: "6 horas", value: "6h" },
  { name: "12 horas", value: "12h" },
  { name: "1 dia", value: "1d" },
  { name: "3 dias", value: "3d" },
  { name: "7 dias", value: "7d" },
] as const;

const VALID_DURATIONS = new Set<string>(MUTE_DURATIONS.map(item => item.value));

function safe(value: string, max = 180): string {
  return String(value ?? "").replace(/[\r\n\t"]/g, " ").trim().slice(0, max);
}
function safeChat(value: string, max = 160): string { return safe(value, max).replace(/[<>]/g, ""); }
function durationLabel(value: string): string {
  return MUTE_DURATIONS.find(item => item.value === value)?.name ?? value;
}
async function moderatorName(interaction: ChatInputCommandInteraction): Promise<string> {
  const member = interaction.guild ? await interaction.guild.members.fetch(interaction.user.id).catch(() => null) : null;
  return member?.roles.cache.has(ANONYMOUS_MODERATOR_ROLE_ID) ? ANONYMOUS_MODERATOR_LABEL : interaction.user.tag;
}

/**
 * A moderação normalmente usa WebRCON. Caso a conexão RCON esteja indisponível,
 * envia o mesmo comando diretamente ao console da host pelo Pterodactyl.
 */
async function executeMuteCommand(command: string): Promise<void> {
  try {
    await executeRconRequired(command);
    return;
  } catch (error) {
    if (!(error instanceof ActionError) || error.status !== 503) throw error;
  }

  try {
    await sendHostConsoleCommand(command);
  } catch {
    throw new ActionError("Servidor Rust indisponível no RCON e no console da host. Nenhuma alteração foi registrada.", 503);
  }
}

async function sendGameNotice(command: string): Promise<void> {
  try {
    await executeRconRequired(command, 1);
  } catch {
    await sendHostConsoleCommand(command).catch(() => null);
  }
}

export const data = new SlashCommandBuilder()
  .setName("mute").setDescription("Muta um jogador do chat do servidor por um período")
  .addStringOption(opt => opt.setName("jogador").setDescription("Pesquise pelo nome ou informe o SteamID64").setRequired(true).setAutocomplete(true))
  .addStringOption(opt => {
    opt.setName("tempo").setDescription("Selecione o tempo da punição").setRequired(true);
    for (const duration of MUTE_DURATIONS) opt.addChoices({ name: duration.name, value: duration.value });
    return opt;
  })
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
    if (!VALID_DURATIONS.has(duration)) throw new ActionError("Tempo de mute inválido. Selecione uma das opções disponíveis.");
    if (!reason) throw new ActionError("Motivo obrigatório.");

    const player = await getPlayerBySteamId(steamId);
    const playerName = safe(player?.playerName || `Jogador (${steamId})`, 100);
    const adminName = await moderatorName(interaction);

    // Better Chat Mute / BetterChatMute. Pode ser sobrescrito por variável caso o servidor use outro comando.
    const template = process.env.MUTE_RCON_COMMAND?.trim() || 'bcm.mute {steamid} {duration} "{reason}"';
    const command = template
      .replace(/\{steamid\}/gi, steamId)
      .replace(/\{duration\}/gi, duration)
      .replace(/\{reason\}/gi, safe(reason, 180));

    await executeMuteCommand(command);

    await db.insert(modLogsTable).values({
      action: "MUTE",
      steamId,
      playerName,
      reason: `${reason} | Duração: ${duration}`,
      adminId: interaction.user.id,
      adminName,
      banDuration: duration,
    });

    await sendGameNotice(
      `say <color=#FFB000>[JOGADOR MUTADO]</color> | <color=#FF8800>${safeChat(playerName,80)}</color> foi mutado pelo administrador <color=#FF4444>${safeChat(adminName,60)}</color>. <color=#FFD166>Tempo:</color> <color=#FFFFFF>${safeChat(durationLabel(duration),40)}</color> | <color=#FFD166>Motivo:</color> <color=#FFFFFF>${safeChat(reason,140)}</color>`
    );

    await interaction.editReply(`✅ **${playerName}** foi mutado por **${durationLabel(duration)}**.\n📝 Motivo: ${reason}`);
  } catch(error) {
    await interaction.editReply(`❌ ${error instanceof ActionError ? error.message : "Falha interna ao mutar o jogador."}`);
  }
}

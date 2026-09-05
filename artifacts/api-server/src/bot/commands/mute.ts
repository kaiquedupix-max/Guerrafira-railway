import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  type ChatInputCommandInteraction,
  type AutocompleteInteraction,
} from "discord.js";
import { and, desc, eq, gt, inArray, isNotNull, lte } from "drizzle-orm";
import { db, modLogsTable } from "@workspace/db";
import { searchPlayers, getPlayerBySteamId } from "../utils/players.js";
import { ActionError } from "../../core/systemActions.js";
import { executeRconCommand } from "../utils/rcon.js";
import { logger } from "../../lib/logger.js";

const STEAM_ID_RE = /^7656119\d{10}$/;
const ANONYMOUS_MODERATOR_ROLE_ID = "1538735197611360347";
const ANONYMOUS_MODERATOR_LABEL = "Equipe de Moderação";

const MUTE_DURATIONS = [
  { name: "10 minutos", value: "10m", ms: 10 * 60_000 },
  { name: "30 minutos", value: "30m", ms: 30 * 60_000 },
  { name: "1 hora", value: "1h", ms: 60 * 60_000 },
  { name: "2 horas", value: "2h", ms: 2 * 60 * 60_000 },
  { name: "6 horas", value: "6h", ms: 6 * 60 * 60_000 },
  { name: "12 horas", value: "12h", ms: 12 * 60 * 60_000 },
  { name: "1 dia", value: "1d", ms: 24 * 60 * 60_000 },
  { name: "3 dias", value: "3d", ms: 3 * 24 * 60 * 60_000 },
  { name: "7 dias", value: "7d", ms: 7 * 24 * 60 * 60_000 },
] as const;
const VALID_DURATIONS = new Set<string>(MUTE_DURATIONS.map(item => item.value));
function safe(value: string, max = 180): string { return String(value ?? "").replace(/[\r\n\t"]/g, " ").trim().slice(0, max); }
function safeChat(value: string, max = 160): string { return safe(value, max).replace(/[<>]/g, ""); }
function durationLabel(value: string): string { return MUTE_DURATIONS.find(item => item.value === value)?.name ?? value; }
function durationMs(value: string): number { return MUTE_DURATIONS.find(item => item.value === value)?.ms ?? 0; }
async function moderatorName(interaction: ChatInputCommandInteraction): Promise<string> {
  const member = interaction.guild ? await interaction.guild.members.fetch(interaction.user.id).catch(() => null) : null;
  return member?.roles.cache.has(ANONYMOUS_MODERATOR_ROLE_ID) ? ANONYMOUS_MODERATOR_LABEL : interaction.user.tag;
}
async function dispatchRustCommand(command: string): Promise<void> {
  const pending = executeRconCommand(command);
  await Promise.race([pending.then(() => undefined), new Promise<void>(resolve => setTimeout(resolve, 1200))]);
}

let expiryWorkerStarted = false;
export function startMuteExpiryChecker(): void {
  if (expiryWorkerStarted) return;
  expiryWorkerStarted = true;
  const run = async () => {
    try {
      const expired = await db.select().from(modLogsTable).where(and(
        eq(modLogsTable.action, "MUTE"), isNotNull(modLogsTable.banExpiresAt), lte(modLogsTable.banExpiresAt, new Date()),
      )).orderBy(desc(modLogsTable.id)).limit(100);
      for (const mute of expired) {
        const [newer] = await db.select({ id: modLogsTable.id, action: modLogsTable.action }).from(modLogsTable).where(and(
          eq(modLogsTable.steamId, mute.steamId), gt(modLogsTable.id, mute.id), inArray(modLogsTable.action, ["MUTE", "UNMUTE", "SYSTEM_UNMUTE"]),
        )).orderBy(desc(modLogsTable.id)).limit(1);
        if (newer) continue;
        await dispatchRustCommand(`unmute ${mute.steamId}`);
        await db.insert(modLogsTable).values({ action: "SYSTEM_UNMUTE", steamId: mute.steamId, playerName: mute.playerName, reason: "Tempo do mute encerrado automaticamente", adminId: "system", adminName: "Sistema Guerra Fria", publicVisible: false });
        logger.info({ steamId: mute.steamId }, "Timed mute expired and native Rust unmute dispatched");
      }
    } catch (error) { logger.error({ error }, "Mute expiry checker failed"); }
  };
  void run();
  setInterval(() => void run(), 30_000).unref();
}
startMuteExpiryChecker();

export const data = new SlashCommandBuilder()
  .setName("mute").setDescription("Muta um jogador do chat do servidor por um período")
  .addStringOption(opt => opt.setName("jogador").setDescription("Pesquise pelo nome ou informe o SteamID64").setRequired(true).setAutocomplete(true))
  .addStringOption(opt => { opt.setName("tempo").setDescription("Selecione o tempo da punição").setRequired(true); for (const duration of MUTE_DURATIONS) opt.addChoices({ name: duration.name, value: duration.value }); return opt; })
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
    const expiresAt = new Date(Date.now() + durationMs(duration));
    await dispatchRustCommand(`mute ${steamId}`);
    await db.insert(modLogsTable).values({ action: "MUTE", steamId, playerName, reason: `${reason} | Duração: ${duration}`, adminId: interaction.user.id, adminName, banDuration: duration, banExpiresAt: expiresAt });
    void dispatchRustCommand(`say <color=#FFB000>[JOGADOR MUTADO]</color> | <color=#FF8800>${safeChat(playerName,80)}</color> foi mutado. <color=#FFD166>Aplicado por:</color> <color=#FF4444>${safeChat(adminName,60)}</color> | <color=#FFD166>Tempo:</color> <color=#FFFFFF>${safeChat(durationLabel(duration),40)}</color> | <color=#FFD166>Motivo:</color> <color=#FFFFFF>${safeChat(reason,140)}</color>`);
    await interaction.editReply(`✅ **${playerName}** foi mutado por **${durationLabel(duration)}**.\n📝 Motivo: ${reason}`);
  } catch(error) {
    logger.error({ error }, "Mute command failed");
    await interaction.editReply(`❌ ${error instanceof ActionError ? error.message : "Falha interna ao mutar o jogador."}`);
  }
}

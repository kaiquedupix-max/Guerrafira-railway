import { moderateChat, muteDurations, applyChatMute, withMuteLock } from "../../core/chatModeration.js";
import { adminServer, withAdminServer } from "../../core/adminServerContext.js";
import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  type ChatInputCommandInteraction,
  type AutocompleteInteraction,
} from "discord.js";
import { and, desc, eq, gt, inArray, isNotNull, lte } from "drizzle-orm";
import { db, modLogsTable } from "@workspace/db";
import { searchPlayers } from "../utils/players.js";
import { ActionError } from "../../core/systemActions.js";
import { logger } from "../../lib/logger.js";

const STEAM_ID_RE = /^7656119\d{10}$/;
const ANONYMOUS_MODERATOR_ROLE_ID = "1538735197611360347";
const ANONYMOUS_MODERATOR_LABEL = "Equipe de Moderação";

const MUTE_DURATIONS = muteDurations;
const VALID_DURATIONS = new Set<string>(MUTE_DURATIONS.map(item => item.value));
function safe(value: string, max = 180): string { return String(value ?? "").replace(/[\r\n\t"]/g, " ").trim().slice(0, max); }
function durationLabel(value: string): string { return MUTE_DURATIONS.find(item => item.value === value)?.name ?? value; }
async function moderatorName(interaction: ChatInputCommandInteraction): Promise<string> {
  const member = interaction.guild ? await interaction.guild.members.fetch(interaction.user.id).catch(() => null) : null;
  if (member?.roles.cache.has(ANONYMOUS_MODERATOR_ROLE_ID)) return ANONYMOUS_MODERATOR_LABEL;
  return member?.displayName?.trim() || interaction.user.globalName?.trim() || interaction.user.username?.trim() || "Administrador";
}

let expiryWorkerStarted = false;
export function startMuteExpiryChecker(): void {
  if (expiryWorkerStarted) return;
  expiryWorkerStarted = true;
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const expired = await db.select().from(modLogsTable).where(and(
        eq(modLogsTable.action, "MUTE"), isNotNull(modLogsTable.banExpiresAt), lte(modLogsTable.banExpiresAt, new Date()),
      )).orderBy(desc(modLogsTable.id)).limit(100);
      for (const mute of expired) {
        await withAdminServer(mute.serverId === "trio" ? "trio" : "solo-duo", async () => withMuteLock(mute.steamId, async () => {
        const [newer] = await db.select({ id: modLogsTable.id, action: modLogsTable.action }).from(modLogsTable).where(and(
          eq(modLogsTable.serverId, adminServer()), eq(modLogsTable.steamId, mute.steamId), gt(modLogsTable.id, mute.id), inArray(modLogsTable.action, ["MUTE", "UNMUTE", "SYSTEM_UNMUTE"]),
        )).orderBy(desc(modLogsTable.id)).limit(1);
        if (newer) { await db.update(modLogsTable).set({ banExpiresAt: null }).where(eq(modLogsTable.id, mute.id)); return; }
        await applyChatMute(mute.steamId, null);
        await db.insert(modLogsTable).values({serverId: adminServer(), action: "SYSTEM_UNMUTE", steamId: mute.steamId, playerName: mute.playerName, reason: "Tempo do mute encerrado automaticamente", adminId: "system", adminName: "Sistema Guerra Fria", publicVisible: false });
        logger.info({ steamId: mute.steamId, serverId: mute.serverId }, "Timed mute expired and native Rust unmute confirmed");
        })).catch(error => logger.error({ error, steamId: mute.steamId }, "Mute expiry pending; retrying next cycle"));
      }
    } catch (error) { logger.error({ error }, "Mute expiry checker failed"); } finally { running = false; }
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
  if (!interaction.inGuild() || !interaction.memberPermissions?.has(PermissionFlagsBits.ModerateMembers)) { await interaction.editReply("❌ Sem permissão para moderar jogadores."); return; }
  try {
    const steamId = interaction.options.getString("jogador", true).trim();
    const duration = interaction.options.getString("tempo", true).trim().toLowerCase();
    const reason = safe(interaction.options.getString("motivo", true), 300);
    if (!STEAM_ID_RE.test(steamId)) throw new ActionError("SteamID inválido.");
    if (!VALID_DURATIONS.has(duration)) throw new ActionError("Tempo de mute inválido. Selecione uma das opções disponíveis.");
    if (!reason) throw new ActionError("Motivo obrigatório.");
    const result = await moderateChat({ steamId, duration, reason, muted: true, actor: { id: interaction.user.id, name: await moderatorName(interaction), source: "discord" } });
    const playerName = result.playerName;
    await interaction.editReply(`✅ **${playerName}** foi mutado por **${durationLabel(duration)}**.\n📝 Motivo: ${reason}`);
  } catch(error) {
    logger.error({ error }, "Mute command failed");
    await interaction.editReply(`❌ ${error instanceof ActionError ? error.message : "Falha interna ao mutar o jogador."}`);
  }
}

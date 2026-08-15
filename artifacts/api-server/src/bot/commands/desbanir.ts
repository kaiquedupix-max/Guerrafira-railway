import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  type ChatInputCommandInteraction,
  type AutocompleteInteraction,
} from "discord.js";
import { eq, and } from "drizzle-orm";
import { db, modLogsTable } from "@workspace/db";
import { executeRconCommand } from "../utils/rcon.js";
import { buildUnbanEmbed } from "../utils/embeds.js";
import { logger } from "../../lib/logger.js";
import { ActionError, unbanPlayer } from "../../core/systemActions.js";

async function getBannedPlayers(query: string) {
  const bans = await db.select().from(modLogsTable).where(eq(modLogsTable.action, "BAN"));
  const unbans = await db.select({ steamId: modLogsTable.steamId }).from(modLogsTable).where(eq(modLogsTable.action, "SYSTEM_UNBAN"));
  const manualUnbans = await db.select({ steamId: modLogsTable.steamId }).from(modLogsTable).where(eq(modLogsTable.action, "DESBANIR"));
  const unbannedSet = new Set([...unbans.map(r => r.steamId), ...manualUnbans.map(r => r.steamId)]);

  const latestBanBySteamId = new Map<string, typeof bans[0]>();
  for (const ban of bans) {
    const existing = latestBanBySteamId.get(ban.steamId);
    if (!existing || ban.createdAt > existing.createdAt) latestBanBySteamId.set(ban.steamId, ban);
  }

  const currentBans = Array.from(latestBanBySteamId.values()).filter(b => !unbannedSet.has(b.steamId));
  const filtered = query ? currentBans.filter(b => b.playerName.toLowerCase().includes(query.toLowerCase()) || b.steamId.includes(query)) : currentBans;
  return filtered.slice(0, 25);
}

export const data = new SlashCommandBuilder()
  .setName("desbanir")
  .setDescription("Remove o banimento de um jogador do servidor")
  .addStringOption(opt => opt.setName("jogador").setDescription("Jogador banido a ser desbanido").setRequired(true).setAutocomplete(true))
  .addStringOption(opt => opt.setName("motivo").setDescription("Motivo do desbanimento").setRequired(true))
  .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers);

export async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const focused = interaction.options.getFocused();
  const banned = await getBannedPlayers(focused);
  if (banned.length === 0) {
    await interaction.respond([{ name: "Nenhum jogador banido encontrado", value: "none" }]);
    return;
  }
  await interaction.respond(banned.map(b => ({
    name: `🔨 ${b.playerName} — ${b.steamId} (${b.banDuration === "perm" ? "Permanente" : b.banDuration ?? "?"})`,
    value: b.steamId,
  })));
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const steamId = interaction.options.getString("jogador", true);
  if (steamId === "none") { await interaction.editReply("❌ Nenhum jogador banido selecionado."); return; }
  try {
    const result = await unbanPlayer({
      steamId,
      reason: interaction.options.getString("motivo", true),
      actor: { id: interaction.user.id, name: interaction.user.tag, source: "discord" },
    });
    await interaction.editReply(`✅ **${result.playerName}** foi desbanido com confirmação do servidor.`);
  } catch (error) {
    await interaction.editReply(`❌ ${error instanceof ActionError ? error.message : "Falha interna ao desbanir."}`);
  }
}

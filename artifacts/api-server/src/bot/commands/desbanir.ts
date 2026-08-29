import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  type ChatInputCommandInteraction,
  type AutocompleteInteraction,
} from "discord.js";
import { desc, inArray } from "drizzle-orm";
import { db, modLogsTable } from "@workspace/db";
import { ActionError, unbanPlayer } from "../../core/systemActions.js";

async function getBannedPlayers(query: string) {
  const history = await db.select().from(modLogsTable)
    .where(inArray(modLogsTable.action, ["BAN", "PREVENTIVE_BAN", "SYSTEM_UNBAN", "DESBANIR"]))
    .orderBy(desc(modLogsTable.createdAt));

  const latestState = new Map<string, typeof history[0]>();
  for (const row of history) if (!latestState.has(row.steamId)) latestState.set(row.steamId, row);

  const currentBans = Array.from(latestState.values()).filter(row => row.action === "BAN" || row.action === "PREVENTIVE_BAN");
  const filtered = query
    ? currentBans.filter(row => row.playerName.toLowerCase().includes(query.toLowerCase()) || row.steamId.includes(query))
    : currentBans;
  return filtered.slice(0, 25);
}

export const data = new SlashCommandBuilder()
  .setName("desbanir")
  .setDescription("Remove banimento normal ou preventivo de um jogador")
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
    name: `${b.action === "PREVENTIVE_BAN" ? "🛡️ PREVENTIVO" : "🔨 BAN"} • ${b.playerName} — ${b.steamId} (${b.banDuration === "perm" ? "Permanente" : b.banDuration ?? "?"})`.slice(0, 100),
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

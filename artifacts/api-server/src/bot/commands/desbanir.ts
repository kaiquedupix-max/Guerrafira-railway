import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  type ChatInputCommandInteraction,
  type AutocompleteInteraction,
} from "discord.js";
import { eq, and, ilike } from "drizzle-orm";
import { db, modLogsTable } from "@workspace/db";
import { executeRconCommand } from "../utils/rcon.js";
import { buildUnbanEmbed } from "../utils/embeds.js";
import { logger } from "../../lib/logger.js";

async function getBannedPlayers(query: string) {
  // Get all BAN records
  const bans = await db
    .select()
    .from(modLogsTable)
    .where(eq(modLogsTable.action, "BAN"));

  // Get all steam IDs that were already unbanned (manual or auto)
  const unbans = await db
    .select({ steamId: modLogsTable.steamId })
    .from(modLogsTable)
    .where(
      eq(modLogsTable.action, "SYSTEM_UNBAN")
    );

  const manualUnbans = await db
    .select({ steamId: modLogsTable.steamId })
    .from(modLogsTable)
    .where(eq(modLogsTable.action, "DESBANIR"));

  const unbannedSet = new Set([
    ...unbans.map((r) => r.steamId),
    ...manualUnbans.map((r) => r.steamId),
  ]);

  // Current bans: keep only the most recent BAN per steamId, excluding unbanned ones
  const latestBanBySteamId = new Map<string, typeof bans[0]>();
  for (const ban of bans) {
    const existing = latestBanBySteamId.get(ban.steamId);
    if (!existing || ban.createdAt > existing.createdAt) {
      latestBanBySteamId.set(ban.steamId, ban);
    }
  }

  const currentBans = Array.from(latestBanBySteamId.values()).filter(
    (b) => !unbannedSet.has(b.steamId)
  );

  // Filter by query
  const filtered = query
    ? currentBans.filter(
        (b) =>
          b.playerName.toLowerCase().includes(query.toLowerCase()) ||
          b.steamId.includes(query)
      )
    : currentBans;

  return filtered.slice(0, 25);
}

export const data = new SlashCommandBuilder()
  .setName("desbanir")
  .setDescription("Remove o banimento de um jogador do servidor")
  .addStringOption((opt) =>
    opt
      .setName("jogador")
      .setDescription("Jogador banido a ser desbanido")
      .setRequired(true)
      .setAutocomplete(true)
  )
  .addStringOption((opt) =>
    opt
      .setName("motivo")
      .setDescription("Motivo do desbanimento")
      .setRequired(true)
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers);

export async function autocomplete(
  interaction: AutocompleteInteraction
): Promise<void> {
  const focused = interaction.options.getFocused();
  const banned = await getBannedPlayers(focused);

  if (banned.length === 0) {
    await interaction.respond([
      { name: "Nenhum jogador banido encontrado", value: "none" },
    ]);
    return;
  }

  await interaction.respond(
    banned.map((b) => ({
      name: `🔨 ${b.playerName} — ${b.steamId} (${b.banDuration === "perm" ? "Permanente" : b.banDuration ?? "?"})`,
      value: b.steamId,
    }))
  );
}

export async function execute(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const steamId = interaction.options.getString("jogador", true);
  const reason  = interaction.options.getString("motivo",  true);

  if (steamId === "none") {
    await interaction.editReply("❌ Nenhum jogador banido selecionado.");
    return;
  }

  // Find the latest ban record for this steamId
  const bans = await db
    .select()
    .from(modLogsTable)
    .where(and(eq(modLogsTable.action, "BAN"), eq(modLogsTable.steamId, steamId)));

  const latestBan = bans.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  if (!latestBan) {
    await interaction.editReply("❌ Registro de banimento não encontrado para este jogador.");
    return;
  }

  // Execute RCON unban
  const rconResult = await executeRconCommand(`unban ${steamId}`);

  // Log the manual unban
  await db.insert(modLogsTable).values({
    action: "DESBANIR",
    steamId: latestBan.steamId,
    playerName: latestBan.playerName,
    reason,
    adminId: interaction.user.id,
    adminName: interaction.user.tag,
  });

  // Post embed to log channel
  const logChannelId = process.env.DISCORD_LOG_CHANNEL_ID;
  if (logChannelId) {
    const ch = await interaction.client.channels.fetch(logChannelId).catch(() => null);
    if (ch?.isSendable()) {
      await ch.send({
        embeds: [
          buildUnbanEmbed({
            playerName: latestBan.playerName,
            steamId: latestBan.steamId,
            reason,
            admin: interaction.user,
          }),
        ],
      });
    }
  }

  const rconWarning = rconResult === null
    ? "\n\n⚠️ *RCON indisponível — desbanimento registrado no banco mas pode não ter sido aplicado no servidor.*"
    : "";

  await interaction.editReply(
    `✅ **${latestBan.playerName}** (\`${steamId}\`) foi desbanido com sucesso.\n📋 Motivo: ${reason}${rconWarning}`
  );

  logger.info(
    { steamId, playerName: latestBan.playerName, reason, admin: interaction.user.tag },
    "Player unbanned"
  );
}

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
import { db, modLogsTable } from "@workspace/db";
import { logger } from "../../lib/logger.js";

const APPEAL_LINK = "discord.gg/guerrafria";

export const data = new SlashCommandBuilder()
  .setName("kickar")
  .setDescription("Expulsa um jogador online do servidor")
  .addStringOption((opt) =>
    opt
      .setName("jogador")
      .setDescription("Nome do jogador a ser expulso")
      .setRequired(true)
      .setAutocomplete(true)
  )
  .addStringOption((opt) =>
    opt
      .setName("motivo")
      .setDescription("Motivo da expulsão")
      .setRequired(true)
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers);

export async function autocomplete(
  interaction: AutocompleteInteraction
): Promise<void> {
  const focused = interaction.options.getFocused();
  const players = await searchPlayers(focused, 25);
  await interaction.respond(
    players.map((p) => ({
      name: `${p.isOnline ? "🟢" : "⚫"} ${p.playerName} — ${p.steamId}`,
      value: p.steamId,
    }))
  );
}

export async function execute(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const steamId = interaction.options.getString("jogador", true);
  const reason  = interaction.options.getString("motivo", true);

  const player = await getPlayerBySteamId(steamId);
  if (!player) {
    await interaction.editReply("❌ Jogador não encontrado no banco de dados.");
    return;
  }

  if (!player.isOnline) {
    await interaction.editReply(
      `⚠️ **${player.playerName}** está **offline**.\n\nNão é possível expulsar um jogador desconectado. Use \`/banir\` se necessário.`
    );
    return;
  }

  const rconReason = `${reason} | Recurso: ${APPEAL_LINK}`;

  const rconResult = await executeRconCommand(
    `kick "${player.playerName}" "${rconReason}"`
  );

  if (rconResult === null) {
    await interaction.editReply(
      "❌ Não foi possível conectar ao RCON. O kick não foi aplicado."
    );
    return;
  }

  // Mantém o histórico interno para consultas administrativas,
  // mas não publica kick no canal Registros do Servidor.
  await db.insert(modLogsTable).values({
    action: "KICK",
    steamId: player.steamId,
    playerName: player.playerName,
    reason,
    adminId: interaction.user.id,
    adminName: interaction.user.tag,
  });

  await interaction.editReply(
    `✅ **${player.playerName}** foi expulso do servidor.\n📋 Motivo: ${reason}`
  );

  logger.info(
    { steamId: player.steamId, playerName: player.playerName, reason, admin: interaction.user.tag },
    "Player kicked"
  );
}

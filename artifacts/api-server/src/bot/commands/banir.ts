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
import { logger } from "../../lib/logger.js";

const APPEAL_LINK = "discord.gg/guerrafria";

function calcExpiry(duration: string): Date | null {
  const now = new Date();
  switch (duration) {
    case "3d":  return new Date(now.getTime() + 3  * 24 * 60 * 60 * 1000);
    case "7d":  return new Date(now.getTime() + 7  * 24 * 60 * 60 * 1000);
    case "30d": return new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    default:    return null; // permanent
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
      .setDescription("Nome do jogador a ser banido")
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

  const steamId  = interaction.options.getString("jogador",  true);
  const duration = interaction.options.getString("duracao",  true);
  const reason   = interaction.options.getString("motivo",   true);

  const player = await getPlayerBySteamId(steamId);
  if (!player) {
    await interaction.editReply("❌ Jogador não encontrado no banco de dados.");
    return;
  }

  const expiresAt = calcExpiry(duration);

  // Build reason string shown to player on the game server
  const rconReason =
    `[${durationLabel(duration).toUpperCase()}] ${reason} | Recurso: ${APPEAL_LINK}`;

  // banid works for online AND offline players
  const rconResult = await executeRconCommand(
    `banid ${player.steamId} "${player.playerName}" "${rconReason}"`
  );

  // Save moderation log
  await db.insert(modLogsTable).values({
    action: "BAN",
    steamId: player.steamId,
    playerName: player.playerName,
    reason,
    adminId: interaction.user.id,
    adminName: interaction.user.tag,
    banDuration: duration,
    banExpiresAt: expiresAt,
  });

  // Post embed to log channel
  const logChannelId = process.env.DISCORD_LOG_CHANNEL_ID;
  if (logChannelId) {
    const ch = await interaction.client.channels.fetch(logChannelId).catch(() => null);
    if (ch?.isSendable()) {
      await ch.send({
        embeds: [
          buildBanEmbed({
            playerName: player.playerName,
            steamId: player.steamId,
            reason,
            duration,
            expiresAt,
            admin: interaction.user,
          }),
        ],
      });
    }
  }

  const expiryText = expiresAt
    ? `📅 Expira: <t:${Math.floor(expiresAt.getTime() / 1000)}:F>`
    : "📅 Banimento **permanente**";

  const rconWarning = rconResult === null
    ? "\n\n⚠️ *RCON indisponível — ban registrado no banco mas pode não ter sido aplicado no servidor.*"
    : "";

  await interaction.editReply(
    `✅ **${player.playerName}** (\`${player.steamId}\`) foi banido por **${durationLabel(duration)}**.\n` +
    `📋 Motivo: ${reason}\n${expiryText}${rconWarning}`
  );

  // Notificação no chat do jogo
  const durationText = durationLabel(duration);
  await executeRconCommand(
    `say <color=#FF4444>⚠ AÇÃO DE MODERAÇÃO</color> | ` +
    `<color=#FFFFFF>${player.playerName}</color> foi banido | ` +
    `<color=#FFAA00>Motivo: ${reason}</color> | ` +
    `<color=#FF4444>Duração: ${durationText}</color> | ` +
    `<color=#00AAFF>Admin: ${interaction.user.username}</color>`
  ).catch(() => {}); // silencia se RCON cair

  logger.info(
    { steamId: player.steamId, playerName: player.playerName, duration, reason, admin: interaction.user.tag },
    "Player banned"
  );
}

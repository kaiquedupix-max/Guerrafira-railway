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

export async function execute(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const selected  = interaction.options.getString("jogador", true).trim();
  const duration  = interaction.options.getString("duracao", true);
  const reason    = interaction.options.getString("motivo", true);

  let player = await getPlayerBySteamId(selected);

  if (!player && !STEAM_ID_RE.test(selected)) {
    await interaction.editReply(
      "❌ Jogador não encontrado no histórico. Pesquise pelo nome ou informe diretamente o SteamID64 do jogador offline."
    );
    return;
  }

  const steamId = player?.steamId ?? selected;
  const playerName = player?.playerName ?? `Jogador offline (${steamId})`;
  const expiresAt = calcExpiry(duration);

  const rconReason =
    `[${durationLabel(duration).toUpperCase()}] ${reason} | Recurso: ${APPEAL_LINK}`;

  // banid aceita SteamID64, portanto funciona mesmo sem o jogador estar conectado.
  const rconResult = await executeRconCommand(
    `banid ${steamId} "${playerName.replace(/"/g, "'")}" "${rconReason.replace(/"/g, "'")}"`
  );

  await db.insert(modLogsTable).values({
    action: "BAN",
    steamId,
    playerName,
    reason,
    adminId: interaction.user.id,
    adminName: interaction.user.tag,
    banDuration: duration,
    banExpiresAt: expiresAt,
  });

  const logChannelId = process.env.DISCORD_LOG_CHANNEL_ID;
  if (logChannelId) {
    const ch = await interaction.client.channels.fetch(logChannelId).catch(() => null);
    if (ch?.isSendable()) {
      await ch.send({
        embeds: [
          buildBanEmbed({
            playerName,
            steamId,
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
    `✅ **${playerName}** (\`${steamId}\`) foi banido por **${durationLabel(duration)}**.\n` +
    `📋 Motivo: ${reason}\n${expiryText}${rconWarning}`
  );

  await executeRconCommand(
    `say <color=#FF4444>⚠ AÇÃO DE MODERAÇÃO</color> | ` +
    `<color=#FFFFFF>${playerName}</color> foi banido | ` +
    `<color=#FFAA00>Motivo: ${reason}</color> | ` +
    `<color=#FF4444>Duração: ${durationLabel(duration)}</color> | ` +
    `<color=#00AAFF>Admin: ${interaction.user.username}</color>`
  ).catch(() => {});

  logger.info(
    { steamId, playerName, duration, reason, admin: interaction.user.tag },
    "Player banned"
  );
}

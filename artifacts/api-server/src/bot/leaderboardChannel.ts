/**
 * Leaderboard channel — mantém apenas um painel de apresentação
 * com acesso ao site completo. O comando /leaderboard continua
 * disponível para consultas rápidas no Discord.
 */

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, type Client, type TextChannel } from "discord.js";
import { logger } from "../lib/logger.js";

const LEADERBOARD_URL = process.env.LEADERBOARD_URL?.trim() || "https://guerrafria.up.railway.app";

function leaderboardButton() {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setLabel("Abrir Leaderboard Completo")
      .setEmoji("🌐")
      .setStyle(ButtonStyle.Link)
      .setURL(LEADERBOARD_URL),
  );
}

function buildPanel(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0xd6a934)
    .setTitle("🏆 Leaderboard Oficial — Guerra Fria 2X")
    .setDescription("Consulte o ranking completo e atualizado do servidor pelo botão abaixo.")
    .setImage("https://raw.githubusercontent.com/kaiquedupix-max/Guerrafira-railway/main/assets/leaderboard-banner.png")
    .setFooter({ text: "Guerra Fria 2X • Leaderboard Oficial" });
}

async function updateChannel(client: Client): Promise<void> {
  const channelId = process.env.DISCORD_LEADERBOARD_CHANNEL_ID;
  if (!channelId) return;

  const ch = await client.channels.fetch(channelId).catch(() => null) as TextChannel | null;
  if (!ch?.isSendable()) return;

  // O canal é apenas uma vitrine. Remove qualquer painel antigo publicado
  // por este bot (Top Kills, KD, HS, Farm etc.) e recria um único cartão.
  const recent = await ch.messages.fetch({ limit: 100 }).catch(() => null);
  const botMsgs = recent ? [...recent.values()].filter(message => message.author.id === client.user?.id) : [];
  for (const message of botMsgs) await message.delete().catch(() => {});

  await ch.send({ embeds: [buildPanel()], components: [leaderboardButton()] });
  logger.info({ channelId, removed: botMsgs.length }, "Single leaderboard presentation card published");
}

export function startLeaderboardChannel(client: Client): void {
  if (!process.env.DISCORD_LEADERBOARD_CHANNEL_ID) {
    logger.info("DISCORD_LEADERBOARD_CHANNEL_ID not set — leaderboard channel disabled");
    return;
  }

  setTimeout(() => updateChannel(client).catch((err) => logger.error({ err }, "Leaderboard channel update error")), 5_000);
  logger.info({ channelId: process.env.DISCORD_LEADERBOARD_CHANNEL_ID }, "Leaderboard presentation panel started");
}

export { updateChannel as refreshLeaderboardChannel };

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
    .setColor(0x8b5cf6)
    .setTitle("🏆 Leaderboard Oficial — Guerra Fria 2X")
    .setDescription(
      "Acompanhe o desempenho dos jogadores durante o wipe no **Leaderboard Oficial do Guerra Fria**.\n\n" +
      "📊 Consulte rankings detalhados de combate, farm, raid, precisão e outras estatísticas registradas automaticamente pelo servidor.\n\n" +
      "🌐 Para visualizar o ranking completo, use o botão abaixo e abra o site no navegador.\n\n" +
      "💬 Prefere consultar pelo Discord? Use **`/leaderboard`** e escolha a categoria desejada."
    )
    .setImage("https://raw.githubusercontent.com/kaiquedupix-max/Guerrafira-railway/main/assets/leaderboard-banner.png")
    .setFooter({ text: "Guerra Fria 2X • Leaderboard Oficial" })
    .setTimestamp();
}

async function updateChannel(client: Client): Promise<void> {
  const channelId = process.env.DISCORD_LEADERBOARD_CHANNEL_ID;
  if (!channelId) return;

  const ch = await client.channels.fetch(channelId).catch(() => null) as TextChannel | null;
  if (!ch?.isSendable()) return;

  const recent = await ch.messages.fetch({ limit: 30 }).catch(() => null);
  const botMsgs = recent
    ? [...recent.values()]
      .filter((m) => m.author.id === client.user?.id && m.embeds.length > 0)
      .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
    : [];

  const panel = buildPanel();
  const main = botMsgs[0];

  // Remove os antigos embeds de Top Kills, KD, HS, Farm etc.
  for (const extra of botMsgs.slice(1)) await extra.delete().catch(() => {});

  if (main) {
    await main.edit({ embeds: [panel], components: [leaderboardButton()] });
    logger.info({ channelId }, "Leaderboard presentation panel updated");
  } else {
    await ch.send({ embeds: [panel], components: [leaderboardButton()] });
    logger.info({ channelId }, "Leaderboard presentation panel created");
  }
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

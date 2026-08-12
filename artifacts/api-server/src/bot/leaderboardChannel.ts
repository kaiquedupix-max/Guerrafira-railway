/**
 * Leaderboard channel — posts / updates all ranking embeds automatically.
 * Set DISCORD_LEADERBOARD_CHANNEL_ID to enable.
 * Updates every 10 minutes.
 */

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, type Client, type TextChannel } from "discord.js";
import { desc, gt, sql } from "drizzle-orm";
import { db, playerStatsTable } from "@workspace/db";
import { logger } from "../lib/logger.js";

const INTERVAL = 10 * 60_000;
const MEDALS = ["🥇", "🥈", "🥉"];
const medal = (i: number) => MEDALS[i] ?? `**${i + 1}.**`;
const LEADERBOARD_URL = process.env.LEADERBOARD_URL?.trim() || "https://guerrafria.up.railway.app";

function fmtNum(n: number, dec = 0): string {
  return n.toLocaleString("pt-BR", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function leaderboardButton() {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setLabel("Abrir Leaderboard Completo")
      .setEmoji("🌐")
      .setStyle(ButtonStyle.Link)
      .setURL(LEADERBOARD_URL),
  );
}

async function buildEmbeds(): Promise<EmbedBuilder[]> {
  const now = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });

  const killRows = await db
    .select({ steamId: playerStatsTable.steamId, playerName: playerStatsTable.playerName, v: playerStatsTable.kills })
    .from(playerStatsTable).where(gt(playerStatsTable.kills, 0))
    .orderBy(desc(playerStatsTable.kills)).limit(10);

  const kdRows = await db
    .select({
      steamId: playerStatsTable.steamId,
      playerName: playerStatsTable.playerName,
      v: sql<number>`ROUND(${playerStatsTable.kills}::numeric / GREATEST(${playerStatsTable.deaths}, 1), 2)`,
    })
    .from(playerStatsTable).where(gt(playerStatsTable.kills, 4))
    .orderBy(desc(sql`${playerStatsTable.kills}::numeric / GREATEST(${playerStatsTable.deaths}, 1)`)).limit(10);

  const hsRows = await db
    .select({
      steamId: playerStatsTable.steamId,
      playerName: playerStatsTable.playerName,
      v: sql<number>`ROUND(${playerStatsTable.headshots}::numeric / GREATEST(${playerStatsTable.kills}, 1) * 100, 1)`,
    })
    .from(playerStatsTable).where(gt(playerStatsTable.kills, 4))
    .orderBy(desc(sql`${playerStatsTable.headshots}::numeric / GREATEST(${playerStatsTable.kills}, 1)`)).limit(10);

  const farmRows = await db
    .select({ steamId: playerStatsTable.steamId, playerName: playerStatsTable.playerName, v: playerStatsTable.resourcesGathered })
    .from(playerStatsTable).where(gt(playerStatsTable.resourcesGathered, 0))
    .orderBy(desc(playerStatsTable.resourcesGathered)).limit(10);

  const expRows = await db
    .select({ steamId: playerStatsTable.steamId, playerName: playerStatsTable.playerName, v: playerStatsTable.explosivesCrafted })
    .from(playerStatsTable).where(gt(playerStatsTable.explosivesCrafted, 0))
    .orderBy(desc(playerStatsTable.explosivesCrafted)).limit(10);

  function buildEmbed(
    title: string,
    color: number,
    rows: { steamId: string; playerName: string; v: number }[],
    suffix: string,
    dec = 0,
    emptyNote?: string,
  ): EmbedBuilder {
    const e = new EmbedBuilder()
      .setColor(color)
      .setTitle(title)
      .setFooter({ text: `Atualizado: ${now} • Guerra Fria 2X` });

    if (!rows.length) {
      e.setDescription(emptyNote ?? "📭 Nenhum dado ainda.");
    } else {
      e.setDescription(
        rows.map((r, i) => `${medal(i)} **${r.playerName}** — **${fmtNum(Number(r.v), dec)}** ${suffix}`).join("\n"),
      );
    }
    return e;
  }

  return [
    new EmbedBuilder()
      .setColor(0x8b5cf6)
      .setTitle("📊  Leaderboard — Guerra Fria 2X")
      .setDescription(
        "Rankings atualizados automaticamente a cada **10 minutos**.\n" +
        "Use `/leaderboard` para consultar uma categoria diretamente no Discord.\n\n" +
        "🌐 **Quer ver todas as estatísticas detalhadas deste wipe?**\n" +
        "Abra o Leaderboard Oficial no navegador pelo botão abaixo.\n\u200b",
      )
      .setImage("https://raw.githubusercontent.com/kaiquedupix-max/Guerrafira-railway/main/assets/leaderboard-banner.png")
      .setTimestamp(),

    buildEmbed("🔫  Top Kills", 0xe74c3c, killRows, "kills"),
    buildEmbed("⚔️  Maior KD", 0xe67e22, kdRows, "KD", 2),
    buildEmbed("🎯  Maior Taxa de HS", 0x9b59b6, hsRows, "% HS", 1),
    buildEmbed(
      "⛏️  Top Farm",
      0x27ae60,
      farmRows,
      "recursos",
      0,
      "📭 Nenhum dado ainda.\n> ℹ️ Instale **GuerraFriaLeaderboard.cs** no servidor Rust para iniciar a coleta.",
    ),
    buildEmbed(
      "💣  Top Craft de Explosivos",
      0xf39c12,
      expRows,
      "explosivos",
      0,
      "📭 Nenhum dado ainda.\n> ℹ️ Instale **GuerraFriaLeaderboard.cs** no servidor Rust para iniciar a coleta.",
    ),
  ];
}

async function updateChannel(client: Client): Promise<void> {
  const channelId = process.env.DISCORD_LEADERBOARD_CHANNEL_ID;
  if (!channelId) return;

  const ch = await client.channels.fetch(channelId).catch(() => null) as TextChannel | null;
  if (!ch?.isSendable()) return;

  const embeds = await buildEmbeds();
  const recent = await ch.messages.fetch({ limit: 20 }).catch(() => null);
  const botMsgs = recent
    ? [...recent.values()]
      .filter((m) => m.author.id === client.user?.id && m.embeds.length > 0)
      .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
    : [];

  if (botMsgs.length === embeds.length) {
    await Promise.all(embeds.map((embed, i) => botMsgs[i]!.edit({ embeds: [embed], components: i === 0 ? [leaderboardButton()] : [] })));
    logger.info({ channelId }, "Leaderboard channel updated");
  } else {
    for (const m of botMsgs) await m.delete().catch(() => {});
    for (let i = 0; i < embeds.length; i++) {
      await ch.send({ embeds: [embeds[i]!], components: i === 0 ? [leaderboardButton()] : [] });
    }
    logger.info({ channelId }, "Leaderboard channel posted fresh");
  }
}

export function startLeaderboardChannel(client: Client): void {
  if (!process.env.DISCORD_LEADERBOARD_CHANNEL_ID) {
    logger.info("DISCORD_LEADERBOARD_CHANNEL_ID not set — leaderboard channel disabled");
    return;
  }

  const run = () => updateChannel(client)
    .catch((err) => logger.error({ err }, "Leaderboard channel update error"));

  setTimeout(run, 5_000);
  setInterval(run, INTERVAL);
  logger.info({ channelId: process.env.DISCORD_LEADERBOARD_CHANNEL_ID }, "Leaderboard channel started");
}

export { updateChannel as refreshLeaderboardChannel };

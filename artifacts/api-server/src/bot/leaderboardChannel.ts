/**
 * Leaderboard channel — posts / updates all ranking embeds automatically.
 * Set DISCORD_LEADERBOARD_CHANNEL_ID to enable.
 * Updates every 10 minutes.
 */

import { EmbedBuilder, type Client, type TextChannel } from "discord.js";
import { desc, gt, sql } from "drizzle-orm";
import { db, playerStatsTable } from "@workspace/db";
import { logger } from "../lib/logger.js";

const INTERVAL  = 10 * 60_000;
const MEDALS    = ["🥇", "🥈", "🥉"];
const medal     = (i: number) => MEDALS[i] ?? `**${i + 1}.**`;

function fmtNum(n: number, dec = 0): string {
  return n.toLocaleString("pt-BR", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

// ─── Build all embeds ─────────────────────────────────────────────────────────
async function buildEmbeds(): Promise<EmbedBuilder[]> {
  const now = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });

  // 1. Top Kills
  const killRows = await db
    .select({ steamId: playerStatsTable.steamId, playerName: playerStatsTable.playerName, v: playerStatsTable.kills })
    .from(playerStatsTable).where(gt(playerStatsTable.kills, 0))
    .orderBy(desc(playerStatsTable.kills)).limit(10);

  // 2. Top KD
  const kdRows = await db
    .select({
      steamId: playerStatsTable.steamId, playerName: playerStatsTable.playerName,
      v: sql<number>`ROUND(${playerStatsTable.kills}::numeric / GREATEST(${playerStatsTable.deaths}, 1), 2)`,
    })
    .from(playerStatsTable).where(gt(playerStatsTable.kills, 4))
    .orderBy(desc(sql`${playerStatsTable.kills}::numeric / GREATEST(${playerStatsTable.deaths}, 1)`)).limit(10);

  // 3. Maior HS%
  const hsRows = await db
    .select({
      steamId: playerStatsTable.steamId, playerName: playerStatsTable.playerName,
      v: sql<number>`ROUND(${playerStatsTable.headshots}::numeric / GREATEST(${playerStatsTable.kills}, 1) * 100, 1)`,
    })
    .from(playerStatsTable).where(gt(playerStatsTable.kills, 4))
    .orderBy(desc(sql`${playerStatsTable.headshots}::numeric / GREATEST(${playerStatsTable.kills}, 1)`)).limit(10);

  // 4. Top Farm
  const farmRows = await db
    .select({ steamId: playerStatsTable.steamId, playerName: playerStatsTable.playerName, v: playerStatsTable.resourcesGathered })
    .from(playerStatsTable).where(gt(playerStatsTable.resourcesGathered, 0))
    .orderBy(desc(playerStatsTable.resourcesGathered)).limit(10);

  // 5. Top Explosivos
  const expRows = await db
    .select({ steamId: playerStatsTable.steamId, playerName: playerStatsTable.playerName, v: playerStatsTable.explosivesCrafted })
    .from(playerStatsTable).where(gt(playerStatsTable.explosivesCrafted, 0))
    .orderBy(desc(playerStatsTable.explosivesCrafted)).limit(10);

  function buildEmbed(
    title: string, color: number,
    rows: { steamId: string; playerName: string; v: number }[],
    suffix: string, dec = 0, emptyNote?: string,
  ): EmbedBuilder {
    const e = new EmbedBuilder().setColor(color).setTitle(title)
      .setFooter({ text: `Atualizado: ${now} • Guerra Fria 2X` });
    if (!rows.length) {
      e.setDescription(emptyNote ?? "📭 Nenhum dado ainda.");
    } else {
      e.setDescription(
        rows.map((r, i) =>
          `${medal(i)} **${r.playerName}** — **${fmtNum(Number(r.v), dec)}** ${suffix}`,
        ).join("\n"),
      );
    }
    return e;
  }

  return [
    new EmbedBuilder()
      .setColor(0x2c2f33)
      .setTitle("📊  Leaderboard — Guerra Fria 2X")
      .setDescription(
        "Rankings atualizados automaticamente a cada **10 minutos**.\n" +
        "Use `/leaderboard` para ver uma categoria específica.\n\u200b",
      )
      .setImage("https://raw.githubusercontent.com/kaiquedupix-max/guerraFria/main/assets/leaderboard-banner.png")
      .setTimestamp(),

    buildEmbed("🔫  Top Kills",              0xe74c3c, killRows,  "kills"),
    buildEmbed("⚔️  Maior KD",               0xe67e22, kdRows,   "KD", 2),
    buildEmbed("🎯  Maior Taxa de HS",        0x9b59b6, hsRows,   "% HS", 1),
    buildEmbed("⛏️  Top Farm",               0x27ae60, farmRows, "recursos", 0,
      "📭 Nenhum dado ainda.\n> ℹ️ Requer plugin **Statistics** instalado no servidor."),
    buildEmbed("💣  Top Craft de Explosivos", 0xf39c12, expRows,  "explosivos", 0,
      "📭 Nenhum dado ainda.\n> ℹ️ Requer plugin **Statistics** instalado no servidor."),
  ];
}

// ─── Post / edit in channel ───────────────────────────────────────────────────
async function updateChannel(client: Client): Promise<void> {
  const channelId = process.env.DISCORD_LEADERBOARD_CHANNEL_ID;
  if (!channelId) return;

  const ch = await client.channels.fetch(channelId).catch(() => null) as TextChannel | null;
  if (!ch?.isSendable()) return;

  const embeds = await buildEmbeds();

  // Find existing bot messages to edit (up to 6 embeds — 1 header + 5 categories)
  const recent  = await (ch as TextChannel).messages.fetch({ limit: 20 }).catch(() => null);
  const botMsgs = recent
    ? [...recent.values()].filter((m) => m.author.id === client.user?.id && m.embeds.length > 0)
      .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
    : [];

  if (botMsgs.length === embeds.length) {
    // Edit existing messages in place
    await Promise.all(embeds.map((embed, i) => botMsgs[i]!.edit({ embeds: [embed] })));
    logger.info({ channelId }, "Leaderboard channel updated");
  } else {
    // Clear old bot messages and post fresh
    for (const m of botMsgs) await m.delete().catch(() => {});
    for (const embed of embeds) await ch.send({ embeds: [embed] });
    logger.info({ channelId }, "Leaderboard channel posted fresh");
  }
}

export function startLeaderboardChannel(client: Client): void {
  if (!process.env.DISCORD_LEADERBOARD_CHANNEL_ID) {
    logger.info("DISCORD_LEADERBOARD_CHANNEL_ID not set — leaderboard channel disabled");
    return;
  }
  const run = () => updateChannel(client).catch((err) => logger.error({ err }, "Leaderboard channel update error"));
  setTimeout(run, 5_000);
  setInterval(run, INTERVAL);
  logger.info({ channelId: process.env.DISCORD_LEADERBOARD_CHANNEL_ID }, "Leaderboard channel started");
}

// Exported for immediate refresh (e.g., after stats update)
export { updateChannel as refreshLeaderboardChannel };

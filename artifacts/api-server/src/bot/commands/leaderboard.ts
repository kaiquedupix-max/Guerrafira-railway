import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
} from "discord.js";
import { desc, gt, sql } from "drizzle-orm";
import { db, playerStatsTable } from "@workspace/db";

const LEADERBOARD_URL = process.env.LEADERBOARD_URL?.trim() || "https://guerrafria.up.railway.app";

const CATEGORIES = [
  { value: "kills",     name: "🔫 Top Kills"              },
  { value: "kd",        name: "⚔️ Maior KD"               },
  { value: "hs",        name: "🎯 Maior Taxa de HS"       },
  { value: "farm",      name: "⛏️ Top Farm"               },
  { value: "scrap",     name: "♻️ Top Sucata"             },
  { value: "explosive", name: "💣 Top Craft de Explosivos" },
] as const;

type Category = (typeof CATEGORIES)[number]["value"];

export const data = new SlashCommandBuilder()
  .setName("leaderboard")
  .setDMPermission(false)
  .setDescription("Exibe o ranking dos melhores jogadores do servidor.")
  .addStringOption((opt) =>
    opt
      .setName("categoria")
      .setDescription("Escolha o ranking que deseja ver")
      .setRequired(true)
      .addChoices(...CATEGORIES.map((c) => ({ name: c.name, value: c.value }))),
  );

const MEDALS = ["🥇", "🥈", "🥉"];
const medal = (i: number) => MEDALS[i] ?? `**${i + 1}.**`;

function fmt(n: number, decimals = 2): string {
  return n.toLocaleString("pt-BR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function websiteButton() {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setLabel("Abrir Leaderboard Completo")
      .setEmoji("🌐")
      .setStyle(ButtonStyle.Link)
      .setURL(LEADERBOARD_URL),
  );
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const cat = interaction.options.getString("categoria", true) as Category;
  let rows: { steamId: string; playerName: string; value: number }[] = [];
  let embedTitle: string;
  let valueLabel: string;
  let color: number;

  if (cat === "kills") {
    embedTitle = "🔫  Top Kills";
    valueLabel = "Kills";
    color = 0xe74c3c;
    rows = await db
      .select({ steamId: playerStatsTable.steamId, playerName: playerStatsTable.playerName, value: playerStatsTable.kills })
      .from(playerStatsTable)
      .where(gt(playerStatsTable.kills, 0))
      .orderBy(desc(playerStatsTable.kills))
      .limit(10);
  } else if (cat === "kd") {
    embedTitle = "⚔️  Maior KD (Kill/Death)";
    valueLabel = "KD";
    color = 0xe67e22;
    const raw = await db
      .select({
        steamId: playerStatsTable.steamId,
        playerName: playerStatsTable.playerName,
        kills: playerStatsTable.kills,
        deaths: playerStatsTable.deaths,
        kd: sql<number>`ROUND(${playerStatsTable.kills}::numeric / GREATEST(${playerStatsTable.deaths}, 1), 2)`,
      })
      .from(playerStatsTable)
      .where(gt(playerStatsTable.kills, 4))
      .orderBy(desc(sql`${playerStatsTable.kills}::numeric / GREATEST(${playerStatsTable.deaths}, 1)`))
      .limit(10);
    rows = raw.map((r) => ({ steamId: r.steamId, playerName: r.playerName, value: Number(r.kd) }));
  } else if (cat === "hs") {
    embedTitle = "🎯  Maior Taxa de HS";
    valueLabel = "HS%";
    color = 0x9b59b6;
    const raw = await db
      .select({
        steamId: playerStatsTable.steamId,
        playerName: playerStatsTable.playerName,
        kills: playerStatsTable.kills,
        headshots: playerStatsTable.headshots,
        hsRate: sql<number>`ROUND(${playerStatsTable.headshots}::numeric / GREATEST(${playerStatsTable.kills}, 1) * 100, 1)`,
      })
      .from(playerStatsTable)
      .where(gt(playerStatsTable.kills, 4))
      .orderBy(desc(sql`${playerStatsTable.headshots}::numeric / GREATEST(${playerStatsTable.kills}, 1)`))
      .limit(10);
    rows = raw.map((r) => ({ steamId: r.steamId, playerName: r.playerName, value: Number(r.hsRate) }));
  } else if (cat === "farm") {
    embedTitle = "⛏️  Top Farm";
    valueLabel = "Recursos";
    color = 0x27ae60;
    rows = await db
      .select({ steamId: playerStatsTable.steamId, playerName: playerStatsTable.playerName, value: playerStatsTable.resourcesGathered })
      .from(playerStatsTable)
      .where(gt(playerStatsTable.resourcesGathered, 0))
      .orderBy(desc(playerStatsTable.resourcesGathered))
      .limit(10);
  } else if (cat === "scrap") {
    embedTitle = "♻️  Top Sucata";
    valueLabel = "Sucata";
    color = 0xd5b45b;
    rows = await db
      .select({ steamId: playerStatsTable.steamId, playerName: playerStatsTable.playerName, value: playerStatsTable.scrapGathered })
      .from(playerStatsTable)
      .where(gt(playerStatsTable.scrapGathered, 0))
      .orderBy(desc(playerStatsTable.scrapGathered))
      .limit(10);
  } else {
    embedTitle = "💣  Top Craft de Explosivos";
    valueLabel = "Explosivos";
    color = 0xf39c12;
    rows = await db
      .select({ steamId: playerStatsTable.steamId, playerName: playerStatsTable.playerName, value: playerStatsTable.explosivesCrafted })
      .from(playerStatsTable)
      .where(gt(playerStatsTable.explosivesCrafted, 0))
      .orderBy(desc(playerStatsTable.explosivesCrafted))
      .limit(10);
  }

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`${embedTitle} — Guerra Fria 2X`)
    .setFooter({ text: "Guerra Fria • Leaderboard • Estatísticas oficiais do wipe" })
    .setTimestamp();

  if (!rows.length) {
    const noDataNote =
      cat === "farm" || cat === "scrap" || cat === "explosive"
        ? "\n\n> ℹ️ A coleta começa após instalar o plugin **GuerraFriaLeaderboard.cs** no servidor Rust."
        : "";
    embed.setDescription(
      `📭 Nenhum dado registrado ainda.${noDataNote}\n\n` +
      "🌐 **Confira o leaderboard detalhado do wipe no site oficial.**",
    );
    await interaction.editReply({ embeds: [embed], components: [websiteButton()] });
    return;
  }

  const lines = rows.map((r, i) => {
    const valStr =
      cat === "kd" ? `**${fmt(r.value)} KD**` :
      cat === "hs" ? `**${fmt(r.value, 1)}%**` :
      `**${r.value.toLocaleString("pt-BR")}** ${valueLabel.toLowerCase()}`;
    return `${medal(i)} **${r.playerName}** — ${valStr}`;
  });

  embed.setDescription(
    `${lines.join("\n")}\n\n` +
    "🌐 **Quer ver todas as categorias e estatísticas detalhadas deste wipe?**\n" +
    "Acesse o Leaderboard Oficial do Guerra Fria pelo botão abaixo.",
  );
  await interaction.editReply({ embeds: [embed], components: [websiteButton()] });
}

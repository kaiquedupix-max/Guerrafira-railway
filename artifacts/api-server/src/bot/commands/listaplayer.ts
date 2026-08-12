/**
 * /listaplayer — lista todos os jogadores cadastrados no servidor
 * com status online/offline, Steam ID visível e botão de cópia por jogador.
 * Suporta pesquisa por nome e navegação por páginas.
 */

import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
} from "discord.js";
import { getPlayersPage } from "../utils/players.js";

const PAGE_SIZE = 10;
const MAX_SEARCH_IN_ID = 40; // chars allowed in customId search portion

// ─── Helpers ─────────────────────────────────────────────────────────────────
function encodeSearch(s: string): string {
  return s.slice(0, MAX_SEARCH_IN_ID).replace(/:/g, "_c_");
}
function decodeSearch(s: string): string {
  return s === "_" ? "" : s.replace(/_c_/g, ":");
}

function truncate(name: string, max = 18): string {
  return name.length > max ? name.slice(0, max - 1) + "…" : name;
}

// ─── Build embed + components ─────────────────────────────────────────────────
async function buildPage(page: number, rawSearch: string) {
  const search = rawSearch.trim();
  const { rows, total } = await getPlayersPage(search, page, PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // ── Embed ──────────────────────────────────────────────────────────────────
  const embed = new EmbedBuilder()
    .setColor(0x2c2f33)
    .setTitle("🎮  Lista de Jogadores — Guerra Fria 2X")
    .setFooter({ text: `Página ${page + 1}/${totalPages} • ${total} jogador${total !== 1 ? "es" : ""} encontrado${total !== 1 ? "s" : ""}${search ? ` para "${search}"` : ""}` })
    .setTimestamp();

  if (!rows.length) {
    embed.setDescription(
      search
        ? `🔍 Nenhum jogador encontrado para **"${search}"**.`
        : "📭 Nenhum jogador cadastrado ainda.",
    );
    return { embed, rows, page, totalPages, search, components: [] as ActionRowBuilder<ButtonBuilder>[] };
  }

  // ── Description: player list ───────────────────────────────────────────────
  const lines = rows.map((p, i) => {
    const n   = page * PAGE_SIZE + i + 1;
    const ico = p.isOnline ? "🟢" : "⚫";
    const last = p.lastSeen
      ? `<t:${Math.floor(new Date(p.lastSeen).getTime() / 1000)}:R>`
      : "—";
    return `\`${String(n).padStart(2, "0")}.\` ${ico} **${p.playerName}**\n` +
           `　Steam ID: \`${p.steamId}\`  •  Visto: ${last}`;
  });
  embed.setDescription(lines.join("\n\n"));

  // ── Copy buttons (up to 2 rows of 5) ──────────────────────────────────────
  const buttonRows: ActionRowBuilder<ButtonBuilder>[] = [];
  const chunks = [rows.slice(0, 5), rows.slice(5, 10)].filter((c) => c.length > 0);

  for (const chunk of chunks) {
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      chunk.map((p, i) => {
        const idx = chunks.indexOf(chunk) * 5 + i + 1 + page * PAGE_SIZE;
        return new ButtonBuilder()
          .setCustomId(`lp_copy:${p.steamId}`)
          .setLabel(`📋 ${String(idx).padStart(2, "0")}. ${truncate(p.playerName)}`)
          .setStyle(ButtonStyle.Secondary);
      }),
    );
    buttonRows.push(row);
  }

  // ── Navigation row ─────────────────────────────────────────────────────────
  const enc = encodeSearch(search) || "_";
  const navRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`lp_nav:${page - 1}:${enc}`)
      .setLabel("◀  Anterior")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(page === 0),
    new ButtonBuilder()
      .setCustomId("lp_pageinfo")
      .setLabel(`Pág. ${page + 1} / ${totalPages}`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId(`lp_nav:${page + 1}:${enc}`)
      .setLabel("Próximo  ▶")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(page >= totalPages - 1),
  );
  buttonRows.push(navRow);

  return { embed, rows, page, totalPages, search, components: buttonRows };
}

// ─── Slash command ─────────────────────────────────────────────────────────────
export const data = new SlashCommandBuilder()
  .setName("listaplayer")
  .setDescription("Lista todos os jogadores do servidor com Steam ID e status.")
  .addStringOption((opt) =>
    opt
      .setName("pesquisa")
      .setDescription("Filtrar por nome de jogador (opcional)")
      .setRequired(false),
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const search = interaction.options.getString("pesquisa") ?? "";
  const { embed, components } = await buildPage(0, search);

  await interaction.editReply({ embeds: [embed], components });
}

// ─── Button handlers (re-exported for index.ts) ───────────────────────────────
export async function handleNav(interaction: ButtonInteraction): Promise<void> {
  // customId: lp_nav:{page}:{encodedSearch}
  const [, , rawPage, encSearch] = interaction.customId.split(":");
  const page   = Math.max(0, parseInt(rawPage ?? "0", 10));
  const search = decodeSearch(encSearch ?? "_");

  await interaction.deferUpdate();
  const { embed, components } = await buildPage(page, search);
  await interaction.editReply({ embeds: [embed], components });
}

export async function handleCopy(interaction: ButtonInteraction): Promise<void> {
  // customId: lp_copy:{steamId}
  const steamId = interaction.customId.slice("lp_copy:".length);

  await interaction.reply({
    content:
      `📋 **Steam ID copiado** — selecione o texto abaixo:\n\`\`\`\n${steamId}\n\`\`\``,
    flags: MessageFlags.Ephemeral,
  });
}

/**
 * /listaplayer — lista jogadores cadastrados, com busca e paginação.
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
  type AutocompleteInteraction,
} from "discord.js";
import { getPlayersPage, searchPlayers } from "../utils/players.js";

const PAGE_SIZE = 10;

function encodeSearch(value: string): string {
  return encodeURIComponent(value.slice(0, 40));
}

function decodeSearch(value: string): string {
  if (!value || value === "_") return "";
  try { return decodeURIComponent(value); } catch { return value; }
}

function shortName(name: string): string {
  return name.length > 18 ? `${name.slice(0, 17)}…` : name;
}

async function buildPage(requestedPage: number, rawSearch: string) {
  const search = rawSearch.trim();
  const first = await getPlayersPage(search, 0, PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(first.total / PAGE_SIZE));
  const page = Math.min(Math.max(0, requestedPage), totalPages - 1);
  const result = page === 0 ? first : await getPlayersPage(search, page, PAGE_SIZE);
  const rows = result.rows;
  const total = result.total;

  const embed = new EmbedBuilder()
    .setColor(0x8b5cf6)
    .setTitle("🎮 Lista de Jogadores — Guerra Fria 2X")
    .setFooter({ text: `Página ${page + 1}/${totalPages} • ${total} jogador${total === 1 ? "" : "es"}` })
    .setTimestamp();

  if (!rows.length) {
    embed.setDescription(search ? `🔎 Nenhum jogador encontrado para **${search}**.` : "📭 Nenhum jogador cadastrado.");
    return { embed, components: [] as ActionRowBuilder<ButtonBuilder>[] };
  }

  embed.setDescription(
    `${search ? `🔎 Busca: **${search}**\n\n` : ""}` +
    rows.map((p, i) => {
      const position = page * PAGE_SIZE + i + 1;
      const status = p.isOnline ? "🟢 Online" : "⚫ Offline";
      const lastSeen = p.lastSeen ? `<t:${Math.floor(new Date(p.lastSeen).getTime() / 1000)}:R>` : "—";
      return `\`${String(position).padStart(2, "0")}.\` **${p.playerName}** • ${status}\nSteam ID: \`${p.steamId}\` • Visto: ${lastSeen}`;
    }).join("\n\n"),
  );

  const components: ActionRowBuilder<ButtonBuilder>[] = [];

  for (let start = 0; start < rows.length; start += 5) {
    const chunk = rows.slice(start, start + 5);
    components.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        chunk.map((p, i) => {
          const position = page * PAGE_SIZE + start + i + 1;
          return new ButtonBuilder()
            .setCustomId(`lp_copy:${p.steamId}`)
            .setLabel(`📋 ${position}. ${shortName(p.playerName)}`)
            .setStyle(ButtonStyle.Secondary);
        }),
      ),
    );
  }

  const encoded = encodeSearch(search) || "_";
  components.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`lp_nav:${page - 1}:${encoded}`)
        .setLabel("◀ Anterior")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(page === 0),
      new ButtonBuilder()
        .setCustomId("lp_pageinfo")
        .setLabel(`Página ${page + 1}/${totalPages}`)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true),
      new ButtonBuilder()
        .setCustomId(`lp_nav:${page + 1}:${encoded}`)
        .setLabel("Próxima ▶")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(page >= totalPages - 1),
    ),
  );

  return { embed, components };
}

export const data = new SlashCommandBuilder()
  .setName("listaplayer")
  .setDescription("Lista e pesquisa jogadores online ou offline.")
  .addStringOption((opt) =>
    opt
      .setName("pesquisa")
      .setDescription("Digite as primeiras letras do nick ou parte do Steam ID")
      .setAutocomplete(true)
      .setRequired(false),
  );

export async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const query = interaction.options.getFocused().trim();
  const players = await searchPlayers(query, 25);
  await interaction.respond(
    players.map((p) => ({
      name: `${p.isOnline ? "🟢" : "⚫"} ${p.playerName} — ${p.steamId}`.slice(0, 100),
      value: p.playerName.slice(0, 100),
    })),
  );
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const search = interaction.options.getString("pesquisa") ?? "";
  const { embed, components } = await buildPage(0, search);
  await interaction.editReply({ embeds: [embed], components });
}

export async function handleNav(interaction: ButtonInteraction): Promise<void> {
  const parts = interaction.customId.split(":");
  const parsedPage = Number.parseInt(parts[1] ?? "0", 10);
  const page = Number.isFinite(parsedPage) ? Math.max(0, parsedPage) : 0;
  const search = decodeSearch(parts.slice(2).join(":") || "_");

  await interaction.deferUpdate();
  const { embed, components } = await buildPage(page, search);
  await interaction.editReply({ embeds: [embed], components });
}

export async function handleCopy(interaction: ButtonInteraction): Promise<void> {
  const steamId = interaction.customId.slice("lp_copy:".length);
  await interaction.reply({
    content: `📋 Steam ID:\n\`\`\`\n${steamId}\n\`\`\``,
    flags: MessageFlags.Ephemeral,
  });
}

import {
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
} from "discord.js";
import { executeRconCommand } from "../utils/rcon.js";
import { getPlayerBySteamId, searchPlayers } from "../utils/players.js";

type TeamMember = {
  steamId: string;
  name: string;
  online?: boolean;
  leader?: boolean;
};

export const data = new SlashCommandBuilder()
  .setName("duo")
  .setDescription("Mostra com quem um jogador está em duo no servidor.")
  .addStringOption((opt) =>
    opt
      .setName("jogador")
      .setDescription("Selecione o jogador pelo nick ou Steam ID")
      .setAutocomplete(true)
      .setRequired(true),
  );

export async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const query = interaction.options.getFocused().trim();
  const players = await searchPlayers(query, 25);
  await interaction.respond(
    players.map((p) => ({
      name: `${p.isOnline ? "🟢" : "⚫"} ${p.playerName} — ${p.steamId}`.slice(0, 100),
      value: p.steamId,
    })),
  );
}

function stringValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function boolValue(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "yes", "online", "1"].includes(normalized)) return true;
    if (["false", "no", "offline", "0"].includes(normalized)) return false;
  }
  return undefined;
}

function parseJsonTeam(raw: string): TeamMember[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    const rows = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object"
        ? ((parsed as Record<string, unknown>).members ??
           (parsed as Record<string, unknown>).Members ??
           (parsed as Record<string, unknown>).players ??
           (parsed as Record<string, unknown>).Players ??
           parsed)
        : [];

    if (!Array.isArray(rows)) return [];

    return rows
      .map((row): TeamMember | null => {
        if (!row || typeof row !== "object") return null;
        const item = row as Record<string, unknown>;
        const steamId = stringValue(item.SteamID ?? item.SteamId ?? item.steamId ?? item.UserId ?? item.userid ?? item.id);
        if (!/^7656119\d{10}$/.test(steamId)) return null;
        const name = stringValue(item.DisplayName ?? item.Username ?? item.Name ?? item.name ?? item.playerName) || "Desconhecido";
        return {
          steamId,
          name,
          online: boolValue(item.Online ?? item.online ?? item.IsOnline ?? item.isOnline),
          leader: boolValue(item.Leader ?? item.leader ?? item.IsLeader ?? item.isLeader),
        };
      })
      .filter((member): member is TeamMember => Boolean(member));
  } catch {
    return [];
  }
}

function parseTextTeam(raw: string): TeamMember[] {
  const members = new Map<string, TeamMember>();
  for (const line of raw.split(/\r?\n/)) {
    const id = line.match(/\b7656119\d{10}\b/)?.[0];
    if (!id) continue;
    const cleaned = line
      .replace(id, "")
      .replace(/\b(true|false|online|offline|leader|yes|no)\b/gi, " ")
      .replace(/[|\t]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^[-:]+|[-:]+$/g, "")
      .trim();
    members.set(id, {
      steamId: id,
      name: cleaned || "Desconhecido",
      online: /\bonline\b|\btrue\b/i.test(line) ? true : /\boffline\b|\bfalse\b/i.test(line) ? false : undefined,
      leader: /\bleader\b/i.test(line) ? true : undefined,
    });
  }
  return [...members.values()];
}

function parseTeam(raw: string): TeamMember[] {
  return parseJsonTeam(raw).length ? parseJsonTeam(raw) : parseTextTeam(raw);
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const input = interaction.options.getString("jogador", true).trim();
  let steamId = input;
  let selected = /^7656119\d{10}$/.test(input) ? await getPlayerBySteamId(input) : null;

  if (!/^7656119\d{10}$/.test(steamId)) {
    const matches = await searchPlayers(input, 5);
    if (!matches.length) {
      await interaction.editReply("❌ Jogador não encontrado no banco de jogadores do servidor.");
      return;
    }
    selected = matches[0];
    steamId = selected.steamId;
  }

  let raw = await executeRconCommand(`teaminfo ${steamId} --json`);
  let members = raw ? parseTeam(raw) : [];

  if (!members.length) {
    raw = await executeRconCommand(`teaminfo ${steamId}`);
    members = raw ? parseTeam(raw) : [];
  }

  const playerName = selected?.playerName ?? members.find((m) => m.steamId === steamId)?.name ?? steamId;

  if (!members.length || members.length === 1) {
    const embed = new EmbedBuilder()
      .setColor(0x64748b)
      .setTitle("👤 Consulta de Duo")
      .setDescription(`**${playerName}** está jogando **sozinho** no momento.`)
      .addFields({ name: "Steam ID", value: `\`${steamId}\`` })
      .setFooter({ text: "Guerra Fria • Dados consultados diretamente do servidor" })
      .setTimestamp();
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  const partners = members.filter((member) => member.steamId !== steamId);
  const embed = new EmbedBuilder()
    .setColor(0x22c55e)
    .setTitle("👥 Duo Encontrado")
    .setDescription(`**${playerName}** está em time com ${partners.length === 1 ? "o jogador abaixo" : "os jogadores abaixo"}:`)
    .addFields(
      { name: "Jogador consultado", value: `**${playerName}**\n\`${steamId}\`` },
      {
        name: partners.length === 1 ? "Parceiro" : "Membros do time",
        value: partners.map((member) => `${member.online === true ? "🟢" : member.online === false ? "⚫" : "👤"} **${member.name}**${member.leader ? " 👑" : ""}\n\`${member.steamId}\``).join("\n\n").slice(0, 1024),
      },
    )
    .setFooter({ text: "Guerra Fria • Dados consultados diretamente do servidor" })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

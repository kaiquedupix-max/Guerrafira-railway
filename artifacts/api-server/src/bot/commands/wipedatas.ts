import {
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Client,
  type TextChannel,
} from "discord.js";
import { pool } from "@workspace/db";

const TIMEZONE = "America/Sao_Paulo";
const UPDATE_INTERVAL_MS = 5 * 60_000;
let updater: ReturnType<typeof setInterval> | null = null;
let tableReady = false;

interface PanelRow {
  guild_id: string;
  channel_id: string;
  message_id: string;
}

async function ensureTable(): Promise<void> {
  if (tableReady) return;
  await pool.query(`CREATE TABLE IF NOT EXISTS wipe_date_panels (
    guild_id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  tableReady = true;
}

function saoPauloParts(date = new Date()): { year: number; month: number; day: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date).filter(part => part.type !== "literal").map(part => [part.type, part.value]),
  );
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
}

function at1830SaoPaulo(year: number, month: number, day: number): Date {
  // São Paulo is UTC-3. Keeping this explicit avoids server-local timezone differences.
  return new Date(Date.UTC(year, month - 1, day, 21, 30, 0));
}

function nextMapWipe(now = new Date()): Date {
  const local = saoPauloParts(now);
  for (let offset = 0; offset < 10; offset++) {
    const calendar = new Date(Date.UTC(local.year, local.month - 1, local.day + offset, 12, 0, 0));
    const dow = calendar.getUTCDay();
    if (dow !== 1 && dow !== 5) continue; // Monday / Friday
    const candidate = at1830SaoPaulo(calendar.getUTCFullYear(), calendar.getUTCMonth() + 1, calendar.getUTCDate());
    if (candidate.getTime() > now.getTime()) return candidate;
  }
  throw new Error("Não foi possível calcular o próximo wipe de mapa.");
}

function firstThursday(year: number, month: number): Date {
  const first = new Date(Date.UTC(year, month - 1, 1, 12, 0, 0));
  const add = (4 - first.getUTCDay() + 7) % 7;
  return at1830SaoPaulo(year, month, 1 + add);
}

function nextFullWipe(now = new Date()): Date {
  const local = saoPauloParts(now);
  let candidate = firstThursday(local.year, local.month);
  if (candidate.getTime() > now.getTime()) return candidate;
  const nextMonth = local.month === 12 ? 1 : local.month + 1;
  const nextYear = local.month === 12 ? local.year + 1 : local.year;
  candidate = firstThursday(nextYear, nextMonth);
  return candidate;
}

function unix(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

export function buildWipeDatesEmbed(now = new Date()): EmbedBuilder {
  const map = nextMapWipe(now);
  const full = nextFullWipe(now);
  const mapTs = unix(map);
  const fullTs = unix(full);

  return new EmbedBuilder()
    .setColor(0xd6a934)
    .setTitle("📅 CALENDÁRIO DE WIPES — GUERRA FRIA")
    .setDescription(
      `🗺️ **Próximo wipe de mapa**\n<t:${mapTs}:F>\n<t:${mapTs}:R>\n\n` +
      `🔥 **Próximo wipe geral / Force Wipe**\n<t:${fullTs}:F>\n<t:${fullTs}:R>\n\n` +
      "Os horários são exibidos automaticamente no fuso de cada usuário do Discord.",
    )
    .setFooter({ text: "Guerra Fria • Atualização automática • 18:30 horário de São Paulo" })
    .setTimestamp();
}

async function editStoredPanel(client: Client, row: PanelRow): Promise<boolean> {
  const channel = await client.channels.fetch(row.channel_id).catch(() => null) as TextChannel | null;
  if (!channel?.isTextBased()) return false;
  const message = await channel.messages.fetch(row.message_id).catch(() => null);
  if (!message || message.author.id !== client.user?.id) return false;
  await message.edit({ embeds: [buildWipeDatesEmbed()] });
  await pool.query("UPDATE wipe_date_panels SET updated_at=NOW() WHERE guild_id=$1", [row.guild_id]);
  return true;
}

export async function refreshWipeDatePanels(client: Client): Promise<void> {
  await ensureTable();
  const result = await pool.query<PanelRow>("SELECT guild_id, channel_id, message_id FROM wipe_date_panels");
  for (const row of result.rows) {
    await editStoredPanel(client, row).catch(() => false);
  }
}

export function startWipeDatesUpdater(client: Client): void {
  if (updater) clearInterval(updater);
  refreshWipeDatePanels(client).catch(() => {});
  updater = setInterval(() => refreshWipeDatePanels(client).catch(() => {}), UPDATE_INTERVAL_MS);
}

export const data = new SlashCommandBuilder()
  .setName("wipedatas")
  .setDescription("Publica e atualiza as próximas datas de wipe com timestamp do Discord.")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand(sub => sub
    .setName("publicar")
    .setDescription("Cria ou move o painel automático de datas de wipe.")
    .addChannelOption(option => option
      .setName("canal")
      .setDescription("Canal onde o calendário ficará")
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      .setRequired(true)))
  .addSubcommand(sub => sub
    .setName("atualizar")
    .setDescription("Força a atualização imediata do painel salvo."));

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    if (!interaction.guildId) throw new Error("Esse comando só pode ser usado dentro de um servidor.");
    await ensureTable();
    const sub = interaction.options.getSubcommand();

    if (sub === "atualizar") {
      const result = await pool.query<PanelRow>(
        "SELECT guild_id, channel_id, message_id FROM wipe_date_panels WHERE guild_id=$1 LIMIT 1",
        [interaction.guildId],
      );
      const row = result.rows[0];
      if (!row) throw new Error("Nenhum painel de datas foi publicado ainda. Use /wipedatas publicar.");
      const ok = await editStoredPanel(interaction.client, row);
      if (!ok) throw new Error("A mensagem salva não existe mais. Publique um novo painel.");
      await interaction.editReply("✅ Datas de wipe atualizadas agora.");
      return;
    }

    const selected = interaction.options.getChannel("canal", true);
    const channel = await interaction.client.channels.fetch(selected.id).catch(() => null);
    if (!channel?.isSendable()) throw new Error("Esse canal não aceita mensagens do bot.");

    const oldResult = await pool.query<PanelRow>(
      "SELECT guild_id, channel_id, message_id FROM wipe_date_panels WHERE guild_id=$1 LIMIT 1",
      [interaction.guildId],
    );
    const old = oldResult.rows[0];

    let sent;
    if (old && old.channel_id === selected.id) {
      const existingChannel = channel as TextChannel;
      const existing = await existingChannel.messages.fetch(old.message_id).catch(() => null);
      if (existing?.author.id === interaction.client.user?.id) {
        await existing.edit({ embeds: [buildWipeDatesEmbed()] });
        sent = existing;
      }
    }

    if (!sent) {
      sent = await channel.send({ embeds: [buildWipeDatesEmbed()] });
      if (old) {
        const oldChannel = await interaction.client.channels.fetch(old.channel_id).catch(() => null) as TextChannel | null;
        const oldMessage = oldChannel?.isTextBased() ? await oldChannel.messages.fetch(old.message_id).catch(() => null) : null;
        if (oldMessage?.author.id === interaction.client.user?.id) await oldMessage.delete().catch(() => {});
      }
    }

    await pool.query(
      `INSERT INTO wipe_date_panels (guild_id, channel_id, message_id, updated_at)
       VALUES ($1,$2,$3,NOW())
       ON CONFLICT (guild_id) DO UPDATE SET channel_id=EXCLUDED.channel_id,message_id=EXCLUDED.message_id,updated_at=NOW()`,
      [interaction.guildId, selected.id, sent.id],
    );

    await interaction.editReply(`✅ Calendário de wipes publicado em <#${selected.id}> e configurado para atualização automática.\nMensagem: ${sent.url}`);
  } catch (error) {
    await interaction.editReply(`❌ ${error instanceof Error ? error.message : "Falha no sistema de datas de wipe."}`);
  }
}

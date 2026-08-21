import {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  Routes,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Client,
  type TextChannel,
} from "discord.js";
import { pool } from "@workspace/db";

const TIMEZONE = "America/Sao_Paulo";
const UPDATE_INTERVAL_MS = 5 * 60_000;
const COMPONENTS_V2_FLAG = 32768;
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
  return new Date(Date.UTC(year, month - 1, day, 21, 30, 0));
}

function nextMapWipe(now = new Date()): Date {
  const local = saoPauloParts(now);
  for (let offset = 0; offset < 10; offset++) {
    const calendar = new Date(Date.UTC(local.year, local.month - 1, local.day + offset, 12, 0, 0));
    const dow = calendar.getUTCDay();
    if (dow !== 1 && dow !== 5) continue;
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

function buildDynamicDatesText(now = new Date()): string {
  const mapTs = unix(nextMapWipe(now));
  const fullTs = unix(nextFullWipe(now));
  return (
    `\nPróximo wipe mapa: **<t:${mapTs}:F>**.\n` +
    `Próximo wipe full: **<t:${fullTs}:F>**.\n\n` +
    "-# :movie_camera: Acompanhe os wipes ao vivo no TikTok: [@vucksgg](https://www.tiktok.com/@vucksgg)"
  );
}

export function buildWipePanelPayload(now = new Date()): any {
  return {
    flags: COMPONENTS_V2_FLAG,
    components: [
      {
        type: 17,
        components: [
          {
            type: 12,
            items: [
              {
                media: {
                  url: "https://discord-webhook.com/uploads/8d0d7db3afa06868169189102f7032cc.png",
                },
              },
            ],
          },
          { type: 14, spacing: 1, divider: true },
          {
            type: 10,
            content: ":flag_br: **[GUERRA FRIA 2X - DUO](https://www.guerrafriarust.com.br/)**:\n```\nclient.connect jogar.guerrafriarust.com.br:28015\n```",
          },
          { type: 14, spacing: 1, divider: true },
          {
            type: 10,
            content: "### :date: Calendário de wipes:\nWipe mapa toda segunda-feira e sexta-feira às `18:30` BRT, e wipe full toda primeira quinta-feira do mês.\n",
          },
          { type: 14, spacing: 1, divider: true },
          {
            type: 10,
            content: buildDynamicDatesText(now),
          },
          { type: 14, spacing: 1, divider: true },
          {
            type: 10,
            content: "\n:busts_in_silhouette: Máximo de 2 jogadores por equipe.\n:sparkles: Adquira seu vip em ⁠<#1530049713422729328>.",
          },
        ],
      },
    ],
  };
}

function messageLink(guildId: string, channelId: string, messageId: string): string {
  return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
}

function parseMessageId(value: string): string | null {
  const trimmed = value.trim();
  if (/^\d{15,25}$/.test(trimmed)) return trimmed;
  const match = trimmed.match(/discord(?:app)?\.com\/channels\/\d+\/\d+\/(\d{15,25})/i);
  return match?.[1] ?? null;
}

async function patchV2Message(client: Client, channelId: string, messageId: string): Promise<void> {
  await client.rest.patch(Routes.channelMessage(channelId, messageId), {
    body: buildWipePanelPayload(),
  });
}

async function editStoredPanel(client: Client, row: PanelRow): Promise<boolean> {
  const channel = await client.channels.fetch(row.channel_id).catch(() => null) as TextChannel | null;
  if (!channel?.isTextBased()) return false;
  const message = await channel.messages.fetch(row.message_id).catch(() => null);
  if (!message || message.author.id !== client.user?.id) return false;
  await patchV2Message(client, row.channel_id, row.message_id);
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
  .setDescription("Publica, vincula e atualiza o painel Components V2 de wipes.")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand(sub => sub
    .setName("publicar")
    .setDescription("Publica o painel Components V2 com datas automáticas.")
    .addChannelOption(option => option
      .setName("canal")
      .setDescription("Canal onde o calendário ficará")
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      .setRequired(true)))
  .addSubcommand(sub => sub
    .setName("vincular")
    .setDescription("Vincula uma mensagem já enviada pelo bot ao atualizador automático.")
    .addChannelOption(option => option
      .setName("canal")
      .setDescription("Canal onde está a mensagem")
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      .setRequired(true))
    .addStringOption(option => option
      .setName("mensagem")
      .setDescription("ID ou link da mensagem enviada pelo bot")
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
      if (!row) throw new Error("Nenhum painel está vinculado. Use /wipedatas publicar ou /wipedatas vincular.");
      const ok = await editStoredPanel(interaction.client, row);
      if (!ok) throw new Error("A mensagem salva não existe mais ou não foi enviada por este bot.");
      await interaction.editReply("✅ Painel Components V2 atualizado com as próximas datas de wipe.");
      return;
    }

    const selected = interaction.options.getChannel("canal", true);
    const channel = await interaction.client.channels.fetch(selected.id).catch(() => null) as TextChannel | null;
    if (!channel?.isTextBased()) throw new Error("Esse canal não aceita mensagens do bot.");

    if (sub === "vincular") {
      const supplied = interaction.options.getString("mensagem", true);
      const messageId = parseMessageId(supplied);
      if (!messageId) throw new Error("Informe um ID de mensagem ou link válido do Discord.");
      const existing = await channel.messages.fetch(messageId).catch(() => null);
      if (!existing) throw new Error("Não encontrei essa mensagem nesse canal.");
      if (existing.author.id !== interaction.client.user?.id) {
        throw new Error("Só posso editar automaticamente mensagens enviadas pelo próprio bot.");
      }

      await patchV2Message(interaction.client, selected.id, messageId);
      await pool.query(
        `INSERT INTO wipe_date_panels (guild_id, channel_id, message_id, updated_at)
         VALUES ($1,$2,$3,NOW())
         ON CONFLICT (guild_id) DO UPDATE SET channel_id=EXCLUDED.channel_id,message_id=EXCLUDED.message_id,updated_at=NOW()`,
        [interaction.guildId, selected.id, messageId],
      );

      await interaction.editReply(
        `✅ Mensagem vinculada ao calendário automático.\n` +
        `As datas serão atualizadas a cada 5 minutos sem recriar o painel.\n` +
        `Mensagem: ${messageLink(interaction.guildId, selected.id, messageId)}`,
      );
      return;
    }

    const oldResult = await pool.query<PanelRow>(
      "SELECT guild_id, channel_id, message_id FROM wipe_date_panels WHERE guild_id=$1 LIMIT 1",
      [interaction.guildId],
    );
    const old = oldResult.rows[0];

    const sent = await interaction.client.rest.post(Routes.channelMessages(selected.id), {
      body: buildWipePanelPayload(),
    }) as { id: string };

    if (old && (old.channel_id !== selected.id || old.message_id !== sent.id)) {
      const oldChannel = await interaction.client.channels.fetch(old.channel_id).catch(() => null) as TextChannel | null;
      const oldMessage = oldChannel?.isTextBased() ? await oldChannel.messages.fetch(old.message_id).catch(() => null) : null;
      if (oldMessage?.author.id === interaction.client.user?.id) await oldMessage.delete().catch(() => {});
    }

    await pool.query(
      `INSERT INTO wipe_date_panels (guild_id, channel_id, message_id, updated_at)
       VALUES ($1,$2,$3,NOW())
       ON CONFLICT (guild_id) DO UPDATE SET channel_id=EXCLUDED.channel_id,message_id=EXCLUDED.message_id,updated_at=NOW()`,
      [interaction.guildId, selected.id, sent.id],
    );

    await interaction.editReply(
      `✅ Painel Components V2 publicado e configurado para atualização automática.\n` +
      `Mensagem: ${messageLink(interaction.guildId, selected.id, sent.id)}`,
    );
  } catch (error) {
    await interaction.editReply(`❌ ${error instanceof Error ? error.message : "Falha no sistema de datas de wipe."}`);
  }
}

import { VIP_STORE_URL } from "./vipArtwork.js";
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Collection,
  EmbedBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  type ButtonInteraction,
  type Client,
  type Message,
  type StringSelectMenuInteraction,
  type TextChannel,
} from "discord.js";
import { db, ticketLogsTable } from "@workspace/db";
import { logger } from "../lib/logger.js";

// ─── Ticket categories ────────────────────────────────────────────────────────
const TICKET_TYPES = [
  { value: "suporte",  label: "🛠️ Suporte Geral",     description: "Dúvidas, bugs e ajuda técnica" },
  { value: "vip",      label: "👑 Suporte VIP",         description: "Ajuda com seu VIP comprado no site" },
  { value: "denuncia", label: "🚨 Denunciar Jogador",   description: "Reporte cheaters ou comportamento inadequado" },
  { value: "recurso",  label: "⚖️ Apelar Banimento",    description: "Conteste uma punição recebida" },
];

// ─── Panel ────────────────────────────────────────────────────────────────────
export async function setupTicketPanel(client: Client): Promise<void> {
  const channelId = process.env.DISCORD_TICKETS_CHANNEL_ID;
  if (!channelId) { logger.warn("DISCORD_TICKETS_CHANNEL_ID not set"); return; }

  const ch = await client.channels.fetch(channelId).catch(() => null) as TextChannel | null;
  if (!ch) { logger.warn({ channelId }, "Ticket panel channel not found"); return; }

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("🎫  Central de Suporte — Guerra Fria")
    .setDescription(
      "Precisa de ajuda? Clique no botão abaixo para abrir um ticket.\n\n" +
      "🛠️ **Suporte Geral** — dúvidas, bugs e ajuda técnica\n" +
      "👑 **Suporte VIP** — ajuda com seu VIP comprado no site\n" +
      "🚨 **Denunciar Jogador** — reporte cheaters ou comportamento tóxico\n" +
      "⚖️ **Apelar Banimento** — conteste uma punição recebida\n\n" +
      "*Um canal privado será criado exclusivamente para você.*",
    )
    .setFooter({ text: "Guerra Fria • Sistema de Suporte" })
    .setTimestamp();

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("ticket_create").setLabel("🎫  Criar Ticket").setStyle(ButtonStyle.Primary),
  );

  const recent   = await ch.messages.fetch({ limit: 20 }).catch(() => null);
  const existing = recent?.find((m) => m.author.id === client.user?.id && m.embeds.length > 0);
  if (existing) await existing.edit({ embeds: [embed], components: [row] }).catch(() => {});
  else await ch.send({ embeds: [embed], components: [row] }).catch(() => {});

  logger.info({ channelId }, "Ticket panel ready");
}

// ─── Step 1: Category selector ────────────────────────────────────────────────
export async function handleTicketCreate(interaction: ButtonInteraction): Promise<void> {
  const select = new StringSelectMenuBuilder()
    .setCustomId("ticket_type_select")
    .setPlaceholder("Selecione o motivo do ticket…")
    .addOptions(TICKET_TYPES.map((t) => ({ label: t.label, value: t.value, description: t.description })));

  await interaction.reply({
    content: "**Qual é o motivo do seu ticket?**",
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
    ephemeral: true,
  });
}

// ─── Step 2: Create private channel ──────────────────────────────────────────
export async function handleTicketTypeSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  await interaction.deferUpdate();

  const type       = interaction.values[0]!;
  const ticketType = TICKET_TYPES.find((t) => t.value === type)!;
  const guild      = interaction.guild!;

  await guild.roles.fetch();
  const adminRoles = guild.roles.cache.filter((r) => r.permissions.has(PermissionFlagsBits.Administrator));
  const safeName   = interaction.user.username.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 20);
  const categoryId = process.env.DISCORD_TICKETS_CATEGORY_ID;

  const ticketChannel = (await guild.channels.create({
    name: `ticket-${type}-${safeName}`,
    type: ChannelType.GuildText,
    parent: categoryId ?? undefined,
    permissionOverwrites: [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      {
        id: interaction.user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.AttachFiles,
        ],
      },
      {
        id: interaction.client.user!.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ManageChannels,
          PermissionFlagsBits.ReadMessageHistory,
        ],
      },
      ...adminRoles.map((r) => ({
        id: r.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.ManageMessages,
        ],
      })),
    ],
    // topic stores opener userId for log retrieval
    topic: `${ticketType.label} | ${interaction.user.tag} | ${interaction.user.id}`,
  })) as TextChannel;

  if (type === "vip") {
    await ticketChannel.send({content:"Compras de VIP são feitas apenas na loja: "+VIP_STORE_URL+". Descreva aqui sua dúvida ou problema com o VIP.",components:[closeRow()]});
  } else {
    const openedAt = new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: "America/Sao_Paulo",
    }).format(new Date());

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(ticketType.label)
      .setDescription(
        `Olá, <@${interaction.user.id}>! 👋\n\n` +
        `Seu ticket foi criado. Descreva sua solicitação e nossa equipe responderá em breve.`,
      )
      .addFields(
        { name: "👤 Usuário",    value: `<@${interaction.user.id}>`, inline: true },
        { name: "📋 Categoria",  value: ticketType.label,             inline: true },
        { name: "🗓️ Aberto em", value: openedAt,                     inline: true },
      )
      .setFooter({ text: "Guerra Fria • Tickets" })
      .setTimestamp();

    await ticketChannel.send({
      content: `<@${interaction.user.id}>`,
      embeds: [embed],
      components: [closeRow()],
    });
  }

  await interaction.editReply({
    content: `✅ Ticket criado! Acesse: <#${ticketChannel.id}>`,
    components: [],
  });

  logger.info({ user: interaction.user.tag, type, channelId: ticketChannel.id }, "Ticket created");
}

export { redirectVipToWebsite as handleVipSelect, redirectVipToWebsite as handleVipModal, redirectVipToWebsite as handleVipPayPix, redirectVipToWebsite as handleVipPayCard, redirectVipToWebsite as handlePixCopy } from "./vipWebLinks.js";

export async function handleTicketClose(interaction: ButtonInteraction): Promise<void> {
  const channel = interaction.channel as TextChannel;



  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(0xe74c3c)
        .setDescription(`🔒 Ticket fechado por <@${interaction.user.id}>. Salvando log e enviando aos participantes...`),
    ],
  });

  try {
    await saveAndSendLog(channel, interaction);
  } catch (err) {
    logger.error({ err, channelId: channel.id }, "Failed to save ticket log");
  }

  setTimeout(() => channel.delete(`Fechado por ${interaction.user.tag}`).catch(() => {}), 6000);
  logger.info({ channelId: channel.id, closedBy: interaction.user.tag }, "Ticket closed");
}

// ─── Transcript helpers ───────────────────────────────────────────────────────
export interface TranscriptMsg {
  authorId:    string;
  author:      string;
  isBot:       boolean;
  content:     string;
  timestamp:   string;
  attachments: string[];
}

export async function fetchTranscript(channel: TextChannel): Promise<TranscriptMsg[]> {
  const messages: TranscriptMsg[] = [];
  let lastId: string | undefined;

  while (true) {
    const batch: Collection<string, Message> = await channel.messages
      .fetch({ limit: 100, ...(lastId ? { before: lastId } : {}) })
      .catch(() => new Collection());

    if (batch.size === 0) break;

    for (const msg of batch.values()) {
      messages.push({
        authorId:    msg.author.id,
        author:      msg.member?.displayName ?? msg.author.username,
        isBot:       msg.author.bot,
        content:     msg.content || (msg.embeds.length ? `[${msg.embeds.length} embed(s)]` : "[sem conteúdo]"),
        timestamp:   msg.createdAt.toISOString(),
        attachments: msg.attachments.map((a) => a.url),
      });
    }

    lastId = batch.last()?.id;
    if (batch.size < 100) break;
  }

  return messages.reverse(); // cronológico
}

function buildTranscriptText(channelName: string, msgs: TranscriptMsg[]): string {
  const header = [
    "═══════════════════════════════════════════",
    `   LOG DO TICKET: ${channelName}`,
    `   Exportado em: ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`,
    "═══════════════════════════════════════════",
    "",
  ].join("\n");

  const lines = msgs.map((m) => {
    const time  = new Date(m.timestamp).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
    const bot   = m.isBot ? " [BOT]" : "";
    const att   = m.attachments.length ? `\n  📎 ${m.attachments.join("\n  📎 ")}` : "";
    return `[${time}] ${m.author}${bot}: ${m.content}${att}`;
  });

  return header + lines.join("\n") + "\n\n═══════════════════════════════════════════\n";
}

async function saveAndSendLog(
  channel: TextChannel,
  interaction: ButtonInteraction,
): Promise<void> {
  // 1. Fetch ALL messages (bots included)
  const transcript = await fetchTranscript(channel);
  const text       = buildTranscriptText(channel.name, transcript);
  const buffer     = Buffer.from(text, "utf-8");
  const fileName   = `ticket-${channel.name}.txt`;

  // 2. Parse opener from topic: "🛠️ Suporte Geral | user#tag | userId"
  const topic      = channel.topic ?? "";
  const parts      = topic.split(" | ");
  const openerId   = parts[parts.length - 1]?.trim() ?? "";
  const ticketType = channel.name.split("-")[1] ?? "unknown";

  // 3. All unique human participants + always include opener
  const humanIds = transcript.filter((m) => !m.isBot).map((m) => m.authorId);
  if (openerId) humanIds.push(openerId);
  humanIds.push(interaction.user.id); // closer (admin)
  const participantIds = [...new Set(humanIds)];

  // 4. Save to DB (upsert so re-close doesn't crash)
  try {
    await db.insert(ticketLogsTable).values({
      ticketChannelId:   channel.id,
      channelName:       channel.name,
      type:              ticketType,
      openedByDiscordId: openerId,
      openedByUsername:  openerId ? (await interaction.client.users.fetch(openerId).catch(() => null))?.username : undefined,
      closedByDiscordId: interaction.user.id,
      closedByUsername:  interaction.user.username,
      closedAt:          new Date(),
      transcript:        JSON.stringify(transcript),
      participantIds:    participantIds.join(","),
    }).onConflictDoNothing();
    logger.info({ channelId: channel.id, msgCount: transcript.length, participants: participantIds.length }, "Ticket log saved");
  } catch (err) {
    logger.error({ err }, "Failed to insert ticket log");
  }

  // 5. Post transcript file IN the ticket channel (users can download before it closes)
  try {
    await channel.send({
      content: `📋 **Log completo do ticket** (o canal será deletado em alguns segundos):`,
      files:   [new AttachmentBuilder(buffer, { name: fileName })],
    });
  } catch { /* channel might already be in process of deletion */ }

  // 6. DM all participants
  const dmEmbed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("📋  Log do Ticket")
    .setDescription(
      `O ticket **${channel.name}** foi fechado por **${interaction.user.username}**.\n` +
      `Segue o histórico completo da conversa em anexo.`,
    )
    .setFooter({ text: "Guerra Fria • Sistema de Tickets" })
    .setTimestamp();

  for (const uid of participantIds) {
    try {
      const user = await interaction.client.users.fetch(uid).catch(() => null);
      if (!user || user.bot) continue;
      await user.send({
        embeds: [dmEmbed],
        files:  [new AttachmentBuilder(buffer, { name: fileName })],
      });
      logger.info({ userId: uid, username: user.username }, "Ticket log DM sent");
    } catch (err) {
      logger.warn({ userId: uid }, "Failed to DM ticket log — user may have DMs disabled");
    }
  }
}

// ─── Public transcript builder (used by /ticketlogs command) ─────────────────
export function buildTranscriptTextFromRaw(
  channelName: string,
  closedAt: Date | null,
  msgs: TranscriptMsg[],
): string {
  return buildTranscriptText(channelName, msgs);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function closeRow(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("ticket_close")
      .setLabel("🔒  Fechar Ticket")
      .setStyle(ButtonStyle.Danger),
  );
}

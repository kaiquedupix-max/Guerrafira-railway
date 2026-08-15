import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Collection,
  EmbedBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type Client,
  type Message,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
  type TextChannel,
} from "discord.js";
import { db, paymentsTable, ticketLogsTable } from "@workspace/db";
import { VIP_TIERS, type VipTier } from "./vip.js";
import { createPixPayment, createCardPreference } from "./mp.js";
import { generateQrCodeBuffer } from "./utils/qrcode.js";
import { logger } from "../lib/logger.js";

// ─── PIX code store (channelId → raw PIX code for copy button) ───────────────
const pixCodeStore = new Map<string, string>();

// ─── In-memory purchase context ───────────────────────────────────────────────
interface PendingPurchase {
  tier:          VipTier;
  steamId:       string;
  email:         string;
  discordUserId: string;
  customPrice?:  number;  // para pacote teste com preço diferente
  customLabel?:  string;  // label exibido no embed de pagamento
}
const pendingVipPurchases = new Map<string, PendingPurchase>();

// ─── Ticket categories ────────────────────────────────────────────────────────
const TICKET_TYPES = [
  { value: "suporte",  label: "🛠️ Suporte Geral",     description: "Dúvidas, bugs e ajuda técnica" },
  { value: "vip",      label: "👑 Comprar VIP",         description: "Adquirir VIP no servidor" },
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
      "👑 **Comprar VIP** — adquira VIP no servidor\n" +
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
    await sendVipCart(ticketChannel, interaction.user.id);
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

// ─── VIP cart ────────────────────────────────────────────────────────────────
async function sendVipCart(channel: TextChannel, userId: string): Promise<void> {
  const testPrice = process.env.VIP_PRATA_TEST_PRICE ? parseFloat(process.env.VIP_PRATA_TEST_PRICE) : null;

  let desc =
    `Olá, <@${userId}>! 👋\n\n` +
    `Selecione abaixo o plano de VIP que deseja adquirir.\n` +
    `Todos os planos têm duração de **30 dias** e são renováveis.\n\n` +
    `🥉 **VIP Bronze** — R$ ${VIP_TIERS.bronze.price.toFixed(2)}\n` +
    `🥈 **VIP Prata** — R$ ${VIP_TIERS.prata.price.toFixed(2)}\n` +
    `🥇 **VIP Ouro** — R$ ${VIP_TIERS.ouro.price.toFixed(2)}\n`;

  if (testPrice) {
    desc += `\n🧪 **VIP Prata (Teste Real)** — R$ ${testPrice.toFixed(2)} *(pagamento real — apenas para testes)*\n`;
  }

  const embed = new EmbedBuilder()
    .setColor(0xf39c12)
    .setTitle("👑  Loja VIP — Guerra Fria")
    .setDescription(desc)
    .setFooter({ text: "Guerra Fria • Pagamentos via Mercado Pago (PIX ou Cartão)" })
    .setTimestamp();

  const tierButtons = [
    new ButtonBuilder().setCustomId("vip_select_bronze").setLabel("🥉 VIP Bronze").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("vip_select_prata").setLabel("🥈 VIP Prata").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("vip_select_ouro").setLabel("🥇 VIP Ouro").setStyle(ButtonStyle.Success),
  ];
  if (testPrice) {
    tierButtons.push(
      new ButtonBuilder().setCustomId("vip_select_teste").setLabel(`🧪 Teste R$ ${testPrice.toFixed(2)}`).setStyle(ButtonStyle.Danger),
    );
  }

  const tierRow = new ActionRowBuilder<ButtonBuilder>().addComponents(...tierButtons);

  await channel.send({ content: `<@${userId}>`, embeds: [embed], components: [tierRow, closeRow()] });
}

// ─── VIP tier button → modal ──────────────────────────────────────────────────
export async function handleVipSelect(interaction: ButtonInteraction): Promise<void> {
  const rawTier = interaction.customId.replace("vip_select_", "");

  // Pacote teste: usa prata como base com preço customizado
  let tier: VipTier = "prata";
  let modalTitle: string;
  let modalId: string;

  if (rawTier === "teste") {
    const testPrice = parseFloat(process.env.VIP_PRATA_TEST_PRICE ?? "1.00");
    modalTitle = `🧪 VIP Prata (Teste) — R$ ${testPrice.toFixed(2)}`;
    modalId    = "vip_modal_teste";
  } else {
    tier       = rawTier as VipTier;
    const vip  = VIP_TIERS[tier];
    if (!vip) return;
    modalTitle = `${vip.emoji} ${vip.name} — R$ ${vip.price.toFixed(2)}`;
    modalId    = `vip_modal_${tier}`;
  }

  const modal = new ModalBuilder()
    .setCustomId(modalId)
    .setTitle(modalTitle)
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("steam_id")
          .setLabel("Seu Steam ID (SteamID64 — 17 dígitos)")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("76561198XXXXXXXXX")
          .setMinLength(17)
          .setMaxLength(17)
          .setRequired(true),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("email")
          .setLabel("Seu e-mail (para o pagamento)")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("seu@email.com")
          .setRequired(true),
      ),
    );

  await interaction.showModal(modal);
}

// ─── VIP modal → payment choice ───────────────────────────────────────────────
export async function handleVipModal(interaction: ModalSubmitInteraction): Promise<void> {
  const rawId   = interaction.customId.replace("vip_modal_", "");
  const isTeste = rawId === "teste";
  const tier    = (isTeste ? "prata" : rawId) as VipTier;
  const vip     = VIP_TIERS[tier];
  if (!vip) return;

  const steamId = interaction.fields.getTextInputValue("steam_id").trim();
  const email   = interaction.fields.getTextInputValue("email").trim();

  if (!/^7656119\d{10}$/.test(steamId)) {
    await interaction.reply({
      content: "❌ SteamID64 inválido. Informe um SteamID real com 17 dígitos, começando por `7656119`.",
      ephemeral: true,
    });
    return;
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    await interaction.reply({
      content: "❌ E-mail inválido. Informe um endereço completo, por exemplo: `nome@gmail.com`.",
      ephemeral: true,
    });
    return;
  }

  const customPrice = isTeste ? parseFloat(process.env.VIP_PRATA_TEST_PRICE ?? "1.00") : undefined;
  const customLabel = isTeste ? `🧪 VIP Prata (Teste) — R$ ${customPrice!.toFixed(2)}` : undefined;

  pendingVipPurchases.set(interaction.channelId!, {
    tier, steamId, email, discordUserId: interaction.user.id, customPrice, customLabel,
  });

  const displayPrice = customPrice ?? vip.price;
  const displayTitle = customLabel ?? `${vip.emoji} ${vip.name} — R$ ${displayPrice.toFixed(2)}`;

  const embed = new EmbedBuilder()
    .setColor(vip.color)
    .setTitle(displayTitle)
    .addFields(
      { name: "🎮 Steam ID", value: `\`${steamId}\``, inline: true },
      { name: "📧 E-mail",   value: email,             inline: true },
    )
    .setDescription("Escolha como prefere pagar:")
    .setFooter({ text: "O VIP será ativado automaticamente após a confirmação do pagamento." });

  const payRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("vip_pay_pix").setLabel("📱 Pagar com PIX").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("vip_pay_card").setLabel("💳 Pagar com Cartão").setStyle(ButtonStyle.Primary),
  );

  await interaction.reply({ embeds: [embed], components: [payRow] });
}

// ─── PIX payment ──────────────────────────────────────────────────────────────
export async function handleVipPayPix(interaction: ButtonInteraction): Promise<void> {
  await interaction.deferReply();

  const ctx = pendingVipPurchases.get(interaction.channelId!);
  if (!ctx) { await interaction.editReply("❌ Sessão expirada. Clique em um plano VIP novamente."); return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(ctx.email)) {
    await interaction.editReply("❌ O e-mail desta sessão é inválido. Clique no plano VIP novamente e informe um e-mail completo, como `nome@gmail.com`.");
    return;
  }

  const vip    = VIP_TIERS[ctx.tier];
  const amount = ctx.customPrice ?? vip.price;
  const label  = ctx.customLabel ?? `${vip.name} 30 dias`;

  const pix = await createPixPayment({
    amount, description: `${label} — Guerra Fria`,
    email: ctx.email, discordUserId: ctx.discordUserId, steamId: ctx.steamId, vipTier: ctx.tier,
  });

  if (!pix) { await interaction.editReply("❌ Erro ao gerar o PIX. Tente novamente ou entre em contato com um administrador."); return; }

  await db.insert(paymentsTable).values({
    mpPaymentId: pix.paymentId, discordUserId: ctx.discordUserId, steamId: ctx.steamId,
    email: ctx.email, vipTier: ctx.tier, amount: String(amount), method: "pix",
    status: "pending", ticketChannelId: interaction.channelId ?? undefined,
  });

  // Mantém a sessão enquanto o ticket estiver aberto para permitir trocar a forma de pagamento.

  const qrBuffer   = await generateQrCodeBuffer(pix.qrCode);
  const attachment = new AttachmentBuilder(qrBuffer, { name: "pix-qr.png" });
  pixCodeStore.set(interaction.channelId!, pix.qrCode);

  const copyRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("pix_copy").setLabel("📋 Copiar Código PIX").setStyle(ButtonStyle.Secondary),
  );

  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle("📱  Pagamento via PIX")
    .setDescription(
      `**Valor:** R$ ${amount.toFixed(2)}\n\n` +
      `Escaneie o QR Code ou clique em **Copiar Código PIX** para pagar.\n\n` +
      `⏰ PIX expira em **30 minutos**.\n` +
      `✅ VIP ativado **automaticamente** após confirmação.`,
    )
    .setImage("attachment://pix-qr.png")
    .setFooter({ text: `Pedido: ${pix.paymentId} • Guerra Fria` });

  await interaction.editReply({ embeds: [embed], files: [attachment], components: [copyRow] });
  logger.info({ paymentId: pix.paymentId, tier: ctx.tier, amount }, "PIX payment created");
}

// ─── Card payment ─────────────────────────────────────────────────────────────
export async function handleVipPayCard(interaction: ButtonInteraction): Promise<void> {
  await interaction.deferReply();

  const ctx = pendingVipPurchases.get(interaction.channelId!);
  if (!ctx) { await interaction.editReply("❌ Sessão expirada. Clique em um plano VIP novamente."); return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(ctx.email)) {
    await interaction.editReply("❌ O e-mail desta sessão é inválido. Clique no plano VIP novamente e informe um e-mail completo, como `nome@gmail.com`.");
    return;
  }

  const vip    = VIP_TIERS[ctx.tier];
  const amount = ctx.customPrice ?? vip.price;
  const label  = ctx.customLabel ?? `${vip.name} 30 dias`;

  const pref = await createCardPreference({
    amount, title: `${label} — Guerra Fria`,
    discordUserId: ctx.discordUserId, steamId: ctx.steamId, vipTier: ctx.tier,
  });

  if (!pref) { await interaction.editReply("❌ Erro ao gerar o checkout. Tente novamente ou use o PIX."); return; }

  await db.insert(paymentsTable).values({
    mpPreferenceId: pref.preferenceId, mpExternalReference: pref.externalReference, discordUserId: ctx.discordUserId, steamId: ctx.steamId,
    email: ctx.email, vipTier: ctx.tier, amount: String(amount), method: "credit_card",
    status: "pending", ticketChannelId: interaction.channelId ?? undefined,
  });

  // Mantém a sessão enquanto o ticket estiver aberto para permitir trocar a forma de pagamento.

  const linkRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setLabel("💳 Ir para o Checkout").setStyle(ButtonStyle.Link).setURL(pref.checkoutUrl),
  );

  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle("💳  Pagamento via Cartão")
    .setDescription(
      `**Valor:** R$ ${amount.toFixed(2)}\n\n` +
      `Clique no botão para acessar o checkout seguro do **Mercado Pago**.\n\n` +
      `✅ VIP ativado **automaticamente** após confirmação.`,
    )
    .setFooter({ text: `Preferência: ${pref.preferenceId} • Guerra Fria` });

  await interaction.editReply({ embeds: [embed], components: [linkRow] });
  logger.info({ preferenceId: pref.preferenceId, tier: ctx.tier, amount }, "Card preference created");
}

/** Botão "📋 Copiar Código PIX" — envia somente o código como texto puro.
 * No Discord mobile, embeds não oferecem "Copiar texto"; mensagens comuns oferecem.
 */
export async function handlePixCopy(interaction: ButtonInteraction): Promise<void> {
  const code = pixCodeStore.get(interaction.channelId!);
  if (!code) {
    await interaction.reply({ content: "❌ Código PIX não encontrado. Gere um novo pagamento.", ephemeral: true });
    return;
  }

  await interaction.reply({
    content: code,
    ephemeral: true,
  });
}

export async function handleTicketClose(interaction: ButtonInteraction): Promise<void> {
  const channel = interaction.channel as TextChannel;
  pendingVipPurchases.delete(channel.id);
  pixCodeStore.delete(channel.id);

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

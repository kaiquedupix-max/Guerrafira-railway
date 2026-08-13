import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ModalSubmitInteraction,
} from "discord.js";
import { db, paymentsTable } from "@workspace/db";
import { VIP_TIERS, type VipTier } from "./vip.js";
import { createPixPayment, createCardPreference } from "./mp.js";
import { generateQrCodeBuffer } from "./utils/qrcode.js";
import { getLinkedSteamV2, saveLinkedSteamV2, STEAM_LOCKED_NOTICE } from "./utils/linkedSteamV2.js";
import { logger } from "../lib/logger.js";
import * as legacy from "./tickets.js";

export const setupTicketPanel = legacy.setupTicketPanel;
export const handleTicketCreate = legacy.handleTicketCreate;
export const handleTicketTypeSelect = legacy.handleTicketTypeSelect;
export const handleTicketClose = legacy.handleTicketClose;

interface PendingPurchase {
  tier: VipTier;
  steamId: string;
  email: string;
  discordUserId: string;
  customPrice?: number;
  customLabel?: string;
}

const pending = new Map<string, PendingPurchase>();
const pixCodes = new Map<string, string>();

function tierInfo(rawTier: string) {
  if (rawTier === "teste") {
    const price = parseFloat(process.env.VIP_PRATA_TEST_PRICE ?? "1.00");
    return {
      tier: "prata" as VipTier,
      title: `🧪 VIP Prata (Teste) — R$ ${price.toFixed(2)}`,
      modalId: "vip_modal_teste",
      customPrice: price,
      customLabel: `🧪 VIP Prata (Teste) — R$ ${price.toFixed(2)}`,
    };
  }
  const tier = rawTier as VipTier;
  const vip = VIP_TIERS[tier];
  if (!vip) return null;
  return { tier, title: `${vip.emoji} ${vip.name} — R$ ${vip.price.toFixed(2)}`, modalId: `vip_modal_${tier}` };
}

export async function handleVipSelect(interaction: ButtonInteraction): Promise<void> {
  const info = tierInfo(interaction.customId.replace("vip_select_", ""));
  if (!info) return;

  const linked = await getLinkedSteamV2(interaction.user.id);
  const modal = new ModalBuilder().setCustomId(info.modalId).setTitle(info.title);

  if (!linked) {
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("steam_id")
          .setLabel("Seu SteamID64 — será vinculado à conta")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("76561198XXXXXXXXX")
          .setMinLength(17)
          .setMaxLength(17)
          .setRequired(true),
      ),
    );
  }

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId("email")
        .setLabel("Seu e-mail para o pagamento")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("seu@email.com")
        .setRequired(true),
    ),
  );

  await interaction.showModal(modal);
}

export async function handleVipModal(interaction: ModalSubmitInteraction): Promise<void> {
  const raw = interaction.customId.replace("vip_modal_", "");
  const info = tierInfo(raw);
  if (!info) return;

  const linked = await getLinkedSteamV2(interaction.user.id);
  let steamId: string;

  if (linked) {
    steamId = linked.steamId;
  } else {
    let informed = "";
    try { informed = interaction.fields.getTextInputValue("steam_id").trim(); } catch {}
    if (!/^\d{17}$/.test(informed)) {
      await interaction.reply({ content: "❌ SteamID64 inválido. Informe exatamente os 17 números.", ephemeral: true });
      return;
    }
    const saved = await saveLinkedSteamV2(interaction.user.id, informed);
    if (!saved.ok) {
      await interaction.reply({ content: saved.reason === "discord-linked" ? STEAM_LOCKED_NOTICE : "❌ Este SteamID já está vinculado a outra conta do Discord. Abra um ticket com a administração.", ephemeral: true });
      return;
    }
    steamId = saved.row!.steamId;
  }

  const email = interaction.fields.getTextInputValue("email").trim();
  const vip = VIP_TIERS[info.tier];
  const channelId = interaction.channelId;
  if (!channelId) return;

  pending.set(channelId, {
    tier: info.tier,
    steamId,
    email,
    discordUserId: interaction.user.id,
    customPrice: info.customPrice,
    customLabel: info.customLabel,
  });

  const amount = info.customPrice ?? vip.price;
  const embed = new EmbedBuilder()
    .setColor(vip.color)
    .setTitle(info.customLabel ?? `${vip.emoji} ${vip.name} — R$ ${amount.toFixed(2)}`)
    .setDescription(
      `🔒 **Steam vinculada automaticamente**\n\`${steamId}\`\n\n` +
      `Se precisar alterar a Steam vinculada, abra um ticket e fale com a administração.\n\n` +
      `Escolha como prefere pagar:`,
    )
    .addFields({ name: "📧 E-mail", value: email, inline: true })
    .setFooter({ text: "O VIP será ativado automaticamente após a confirmação do pagamento." });

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("vip_pay_pix").setLabel("📱 Pagar com PIX").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("vip_pay_card").setLabel("💳 Pagar com Cartão").setStyle(ButtonStyle.Primary),
  );
  await interaction.reply({ embeds: [embed], components: [row] });
}

export async function handleVipPayPix(interaction: ButtonInteraction): Promise<void> {
  await interaction.deferReply();
  const channelId = interaction.channelId;
  const ctx = channelId ? pending.get(channelId) : undefined;
  if (!ctx) { await interaction.editReply("❌ Sessão expirada. Clique no plano VIP novamente."); return; }

  const vip = VIP_TIERS[ctx.tier];
  const amount = ctx.customPrice ?? vip.price;
  const label = ctx.customLabel ?? `${vip.name} 30 dias`;
  const pix = await createPixPayment({ amount, description: `${label} — Guerra Fria`, email: ctx.email, discordUserId: ctx.discordUserId, steamId: ctx.steamId, vipTier: ctx.tier });
  if (!pix) { await interaction.editReply("❌ Erro ao gerar o PIX. Tente novamente."); return; }

  await db.insert(paymentsTable).values({ mpPaymentId: pix.paymentId, discordUserId: ctx.discordUserId, steamId: ctx.steamId, email: ctx.email, vipTier: ctx.tier, amount: String(amount), method: "pix", status: "pending", ticketChannelId: channelId ?? undefined });
  pending.delete(channelId!);
  pixCodes.set(channelId!, pix.qrCode);

  const qr = await generateQrCodeBuffer(pix.qrCode);
  const attachment = new AttachmentBuilder(qr, { name: "pix-qr.png" });
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId("pix_copy").setLabel("📋 Copiar Código PIX").setStyle(ButtonStyle.Secondary));
  const embed = new EmbedBuilder().setColor(0x2ecc71).setTitle("📱 Pagamento via PIX")
    .setDescription(`**Valor:** R$ ${amount.toFixed(2)}\n\n🔒 Steam vinculada: \`${ctx.steamId}\`\n\nEscaneie o QR Code ou copie o código PIX.\n\n⏰ PIX expira em **30 minutos**.\n✅ VIP ativado automaticamente após confirmação.`)
    .setImage("attachment://pix-qr.png").setFooter({ text: `Pedido: ${pix.paymentId} • Guerra Fria` });
  await interaction.editReply({ embeds: [embed], files: [attachment], components: [row] });
  logger.info({ paymentId: pix.paymentId, tier: ctx.tier }, "PIX VIP created with linked Steam");
}

export async function handleVipPayCard(interaction: ButtonInteraction): Promise<void> {
  await interaction.deferReply();
  const channelId = interaction.channelId;
  const ctx = channelId ? pending.get(channelId) : undefined;
  if (!ctx) { await interaction.editReply("❌ Sessão expirada. Clique no plano VIP novamente."); return; }

  const vip = VIP_TIERS[ctx.tier];
  const amount = ctx.customPrice ?? vip.price;
  const label = ctx.customLabel ?? `${vip.name} 30 dias`;
  const pref = await createCardPreference({ amount, title: `${label} — Guerra Fria`, discordUserId: ctx.discordUserId, steamId: ctx.steamId, vipTier: ctx.tier });
  if (!pref) { await interaction.editReply("❌ Erro ao gerar o checkout. Tente novamente ou use PIX."); return; }

  await db.insert(paymentsTable).values({ mpPreferenceId: pref.preferenceId, discordUserId: ctx.discordUserId, steamId: ctx.steamId, email: ctx.email, vipTier: ctx.tier, amount: String(amount), method: "credit_card", status: "pending", ticketChannelId: channelId ?? undefined });
  pending.delete(channelId!);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setLabel("💳 Ir para o Checkout").setStyle(ButtonStyle.Link).setURL(pref.checkoutUrl));
  const embed = new EmbedBuilder().setColor(0x3498db).setTitle("💳 Pagamento via Cartão")
    .setDescription(`**Valor:** R$ ${amount.toFixed(2)}\n\n🔒 Steam vinculada: \`${ctx.steamId}\`\n\nClique no botão para acessar o checkout seguro do Mercado Pago.\n\n✅ VIP ativado automaticamente após confirmação.`)
    .setFooter({ text: `Preferência: ${pref.preferenceId} • Guerra Fria` });
  await interaction.editReply({ embeds: [embed], components: [row] });
}

export async function handlePixCopy(interaction: ButtonInteraction): Promise<void> {
  const code = pixCodes.get(interaction.channelId!);
  if (!code) { await interaction.reply({ content: "❌ Código PIX não encontrado. Gere um novo pagamento.", ephemeral: true }); return; }
  await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x2ecc71).setTitle("📋 Código PIX — Copia e Cola").setDescription(`Selecione e copie o código abaixo:\n\n\`\`\`${code}\`\`\``).setFooter({ text: "Guerra Fria • Só você está vendo esta mensagem" })], ephemeral: true });
}

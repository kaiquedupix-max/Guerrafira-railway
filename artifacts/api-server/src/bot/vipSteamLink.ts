import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ModalSubmitInteraction,
} from "discord.js";
import { db, boosterLinksTable, paymentsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { VIP_TIERS, type VipTier } from "./vip.js";
import { createStripeCheckout, isStripeConfigured } from "./stripe.js";
import { handleVipModal as continueVipModal } from "./tickets.js";
import { logger } from "../lib/logger.js";

export async function openVipModal(interaction: ButtonInteraction): Promise<void> {
  const raw = interaction.customId.replace("vip_select_", "");
  const tier = (raw === "teste" ? "prata" : raw) as VipTier;
  const vip = VIP_TIERS[tier];
  if (!vip) return;
  const [saved] = await db.select().from(boosterLinksTable).where(eq(boosterLinksTable.discordUserId, interaction.user.id)).limit(1);
  const price = raw === "teste" ? parseFloat(process.env.VIP_PRATA_TEST_PRICE ?? "1.00") : vip.price;
  const steam = new TextInputBuilder().setCustomId("steam_id").setLabel(saved ? "Steam vinculada — não altere" : "Seu Steam ID (SteamID64)").setStyle(TextInputStyle.Short).setMinLength(17).setMaxLength(17).setRequired(true);
  if (saved) steam.setValue(saved.steamId); else steam.setPlaceholder("76561198XXXXXXXXX");
  const email = new TextInputBuilder().setCustomId("email").setLabel("Seu e-mail").setStyle(TextInputStyle.Short).setRequired(true);
  const modal = new ModalBuilder().setCustomId(`vip_modal_${raw}`).setTitle(`${vip.emoji} ${vip.name} — R$ ${price.toFixed(2)}`).addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(steam), new ActionRowBuilder<TextInputBuilder>().addComponents(email));
  await interaction.showModal(modal);
}

export async function submitVipModal(interaction: ModalSubmitInteraction): Promise<void> {
  const raw = interaction.customId.replace("vip_modal_", "");
  const tier = (raw === "teste" ? "prata" : raw) as VipTier;
  const vip = VIP_TIERS[tier];
  if (!vip) return;

  const steamId = interaction.fields.getTextInputValue("steam_id").trim();
  const email = interaction.fields.getTextInputValue("email").trim();

  if (!/^7656119\d{10}$/.test(steamId)) {
    await interaction.reply({ content: "❌ SteamID64 inválido. Informe um SteamID real com 17 dígitos, começando por `7656119`.", ephemeral: true });
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    await interaction.reply({ content: "❌ E-mail inválido. Informe um endereço completo, por exemplo: `nome@gmail.com`.", ephemeral: true });
    return;
  }

  const [saved] = await db.select().from(boosterLinksTable).where(eq(boosterLinksTable.discordUserId, interaction.user.id)).limit(1);
  if (saved && saved.steamId !== steamId) {
    await interaction.reply({ content: `🔒 Sua conta já possui a Steam \`${saved.steamId}\` vinculada. Para alterar, abra um ticket com a administração.`, ephemeral: true });
    return;
  }
  const [owner] = await db.select().from(boosterLinksTable).where(eq(boosterLinksTable.steamId, steamId)).limit(1);
  if (owner && owner.discordUserId !== interaction.user.id) {
    await interaction.reply({ content: "❌ Este SteamID já está vinculado a outra conta. Abra um ticket com a administração.", ephemeral: true });
    return;
  }
  if (!saved) await db.insert(boosterLinksTable).values({ discordUserId: interaction.user.id, steamId, active: false, updatedAt: new Date() });

  // Mantém o fluxo atual de PIX e cartão Mercado Pago. Ele também registra o
  // contexto da compra usado pelos handlers existentes do bot.
  await continueVipModal(interaction);

  const components = [
    new ButtonBuilder().setCustomId("vip_pay_pix").setLabel("📱 PIX • Mercado Pago").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("vip_pay_card").setLabel("💳 Cartão • Mercado Pago").setStyle(ButtonStyle.Primary),
  ];

  if (!isStripeConfigured()) {
    components.push(
      new ButtonBuilder()
        .setCustomId("vip_pay_stripe_unavailable")
        .setLabel("💳 Stripe indisponível")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true),
    );
    await interaction.editReply({ components: [new ActionRowBuilder<ButtonBuilder>().addComponents(...components)] });
    return;
  }

  const amount = raw === "teste"
    ? parseFloat(process.env.VIP_PRATA_TEST_PRICE ?? "1.00")
    : vip.price;
  const label = raw === "teste"
    ? `VIP Prata (Teste) — R$ ${amount.toFixed(2)}`
    : `${vip.name} 30 dias`;

  try {
    const [paymentRow] = await db.insert(paymentsTable).values({
      discordUserId: interaction.user.id,
      steamId,
      email,
      vipTier: tier,
      amount: String(amount),
      method: "stripe_card",
      status: "pending",
      ticketChannelId: interaction.channelId ?? undefined,
    }).returning({ id: paymentsTable.id });

    if (!paymentRow) throw new Error("Stripe payment row was not created");

    const checkout = await createStripeCheckout({
      paymentRowId: paymentRow.id,
      amount,
      title: `${label} — Guerra Fria`,
      email,
      discordUserId: interaction.user.id,
      steamId,
      vipTier: tier,
    });

    if ("error" in checkout) {
      await db.update(paymentsTable)
        .set({ status: "failed", updatedAt: new Date() })
        .where(eq(paymentsTable.id, paymentRow.id));
      throw new Error(checkout.error);
    }

    await db.update(paymentsTable)
      .set({ stripeSessionId: checkout.sessionId, updatedAt: new Date() })
      .where(eq(paymentsTable.id, paymentRow.id));

    components.push(
      new ButtonBuilder()
        .setLabel("💳 Cartão • Stripe")
        .setStyle(ButtonStyle.Link)
        .setURL(checkout.checkoutUrl),
    );

    await interaction.editReply({
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(...components)],
    });

    logger.info({
      sessionId: checkout.sessionId,
      paymentRowId: paymentRow.id,
      tier,
      channelId: interaction.channelId,
      discordUserId: interaction.user.id,
    }, "Stripe checkout attached to active Discord VIP purchase flow");
  } catch (err) {
    logger.error({ err, tier, channelId: interaction.channelId, discordUserId: interaction.user.id }, "Could not attach Stripe checkout to Discord VIP purchase flow");
    components.push(
      new ButtonBuilder()
        .setCustomId("vip_pay_stripe_error")
        .setLabel("💳 Stripe indisponível")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true),
    );
    await interaction.editReply({ components: [new ActionRowBuilder<ButtonBuilder>().addComponents(...components)] }).catch(() => {});
  }
}

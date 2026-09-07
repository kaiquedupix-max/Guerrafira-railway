import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  Events,
  type Client,
  type TextChannel,
} from "discord.js";
import { VIP_TIERS, type VipTier } from "./vip.js";
import { handleVipStoreBuy } from "./vipStorePurchase.js";
import { startBoosterSystem } from "./booster.js";
import { startDiscordModeration } from "./moderation.js";
import { logger } from "../lib/logger.js";

const STORE_MARKER = "Guerra Fria • Loja VIP";
const DEFAULT_VIP_STORE_CHANNEL_ID = "1530049713422729328";
let storeInteractionHandlerRegistered = false;
let moderationStarted = false;

const VIP_CARDS: Array<{
  tier: VipTier;
  title: string;
  description: string;
  imageEnv: string;
}> = [
  {
    tier: "bronze",
    title: "🥉 VIP Bronze",
    description:
      "Apoie o servidor Guerra Fria e receba acesso ao pacote VIP Bronze por **30 dias**.\n\n" +
      "Sua compra ajuda diretamente a manter o servidor funcionando, cobrindo hospedagem, infraestrutura e melhorias.\n\n" +
      "📦 **Importante:** os kits e benefícios podem ser ajustados ao longo do tempo para manter o equilíbrio do servidor.",
    imageEnv: "VIP_BRONZE_IMAGE_URL",
  },
  {
    tier: "prata",
    title: "🥈 VIP Prata",
    description:
      "Apoie o servidor Guerra Fria e receba acesso ao pacote VIP Prata por **30 dias**.\n\n" +
      "Sua compra ajuda diretamente a manter o servidor funcionando, cobrindo hospedagem, infraestrutura e melhorias.\n\n" +
      "📦 **Importante:** os kits e benefícios podem ser ajustados ao longo do tempo para manter o equilíbrio do servidor.",
    imageEnv: "VIP_PRATA_IMAGE_URL",
  },
  {
    tier: "ouro",
    title: "🥇 VIP Ouro",
    description:
      "Apoie o servidor Guerra Fria e receba acesso ao pacote VIP Ouro por **30 dias**.\n\n" +
      "Sua compra ajuda diretamente a manter o servidor funcionando, cobrindo hospedagem, infraestrutura e melhorias.\n\n" +
      "📦 **Importante:** os kits e benefícios podem ser ajustados ao longo do tempo para manter o equilíbrio do servidor.",
    imageEnv: "VIP_OURO_IMAGE_URL",
  },
];

function safeImageUrl(envKey: string): string | null {
  const value = process.env[envKey]?.trim();
  if (!value) return null;

  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return value;
  } catch {
    logger.warn({ envKey, value }, "Invalid VIP image URL — card will be sent without image");
    return null;
  }
}

function buildCard(card: (typeof VIP_CARDS)[number], includeImage = true) {
  const vip = VIP_TIERS[card.tier];
  const embed = new EmbedBuilder()
    .setColor(vip.color)
    .setTitle(card.title)
    .setDescription(card.description)
    .addFields(
      { name: "💰 Valor", value: `R$ ${vip.price.toFixed(2)}`, inline: true },
      { name: "⏱️ Duração", value: "30 dias", inline: true },
      { name: "💳 Pagamento", value: "PIX ou Cartão", inline: true },
    )
    .setFooter({ text: `${STORE_MARKER} • Pagamentos via Mercado Pago` });

  if (includeImage) {
    const imageUrl = safeImageUrl(card.imageEnv);
    if (imageUrl) embed.setImage(imageUrl);
  }

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`vip_store_buy_${card.tier}`)
      .setLabel(`Comprar ${vip.name}`)
      .setEmoji(vip.emoji)
      .setStyle(card.tier === "ouro" ? ButtonStyle.Success : card.tier === "prata" ? ButtonStyle.Primary : ButtonStyle.Secondary),
  );

  return { embed, row };
}

async function sendStoreMessage(
  channel: TextChannel,
  payload: Parameters<TextChannel["send"]>[0],
  label: string,
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      await channel.send(payload);
      return;
    } catch (err) {
      lastError = err;
      logger.warn({ err, label, attempt }, "VIP store message failed; retrying");
      await new Promise(resolve => setTimeout(resolve, attempt * 2_000));
    }
  }
  throw lastError;
}

function registerStoreInteractionHandler(client: Client): void {
  if (storeInteractionHandlerRegistered) return;
  storeInteractionHandlerRegistered = true;

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isButton()) return;
    if (!interaction.customId.startsWith("vip_store_buy_")) return;

    try {
      await handleVipStoreBuy(interaction);
    } catch (err) {
      logger.error({ err, customId: interaction.customId }, "VIP store button interaction failed");

      try {
        const payload = { content: "❌ Não foi possível criar o ticket de compra. Tente novamente.", ephemeral: true };
        if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
        else await interaction.reply(payload);
      } catch {
        // ignore response failure
      }
    }
  });
}

async function hasExistingStorePanel(channel: TextChannel, client: Client): Promise<boolean> {
  const recent = await channel.messages.fetch({ limit: 100 }).catch((err) => {
    logger.warn({ err, channelId: channel.id }, "Could not inspect VIP store messages");
    return null;
  });
  if (!recent) return true;

  return recent.some(message =>
    message.author.id === client.user?.id &&
    message.embeds.some(embed => embed.footer?.text?.includes(STORE_MARKER)),
  );
}

export async function setupVipStore(client: Client): Promise<void> {
  registerStoreInteractionHandler(client);
  if (!moderationStarted) {
    startDiscordModeration(client);
    moderationStarted = true;
  }
  await startBoosterSystem(client).catch((err) => logger.error({ err }, "Failed to start booster system"));

  const channelId =
    process.env.DISCORD_VIP_STORE_CHANNEL_ID?.trim() ||
    process.env.DISCORD_VIP_CHANNEL_ID?.trim() ||
    DEFAULT_VIP_STORE_CHANNEL_ID;

  logger.info({ channelId }, "Initializing VIP store panel");

  const channel = await client.channels.fetch(channelId).catch((err) => {
    logger.error({ err, channelId }, "Failed to fetch VIP store channel");
    return null;
  }) as TextChannel | null;

  if (!channel?.isTextBased() || !channel.isSendable()) {
    logger.error({ channelId }, "VIP store channel not found or bot cannot send messages there");
    return;
  }

  if (channel.id !== DEFAULT_VIP_STORE_CHANNEL_ID) {
    logger.error({ configuredChannelId: channel.id, expectedChannelId: DEFAULT_VIP_STORE_CHANNEL_ID }, "VIP store publishing blocked for unexpected channel");
    return;
  }

  // Reinício do bot não deve limpar o canal nem relançar os cards.
  if (await hasExistingStorePanel(channel, client)) {
    logger.info({ channelId }, "Existing VIP store panel preserved; no cards republished");
    return;
  }

  const header = new EmbedBuilder()
    .setColor(0x111827)
    .setTitle("👑 Loja VIP — Guerra Fria")
    .setDescription(
      "Escolha abaixo o VIP que deseja adquirir. Cada opção possui seu próprio botão de compra.\n\n" +
      "Ao comprar um VIP, você **ajuda a manter o servidor funcionando** e contribui para custos de hospedagem, infraestrutura e futuras melhorias.",
    )
    .setFooter({ text: `${STORE_MARKER} • Compra segura e ativação automática` });

  try {
    await sendStoreMessage(channel, { embeds: [header] }, "header");
  } catch (err) {
    logger.error({ err, channelId }, "VIP store header could not be published");
  }

  let sentCount = 0;

  for (const card of VIP_CARDS) {
    try {
      const { embed, row } = buildCard(card, true);
      await sendStoreMessage(channel, { embeds: [embed], components: [row] }, `card-${card.tier}-with-image`);
      sentCount += 1;
      logger.info({ tier: card.tier, channelId }, "VIP store card published");
    } catch (err) {
      logger.error({ err, tier: card.tier }, "VIP card failed with image — retrying without image");

      try {
        const { embed, row } = buildCard(card, false);
        await sendStoreMessage(channel, { embeds: [embed], components: [row] }, `card-${card.tier}-without-image`);
        sentCount += 1;
        logger.info({ tier: card.tier, channelId }, "VIP store card published without image");
      } catch (retryErr) {
        logger.error({ err: retryErr, tier: card.tier }, "VIP store card could not be published");
      }
    }
  }

  logger.info({ channelId, sentCount, expected: VIP_CARDS.length }, "VIP store panel ready");
}

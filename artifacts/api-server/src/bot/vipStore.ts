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
import { handleVipPayStripe } from "./ticketsLinked.js";
import { startBoosterSystem } from "./booster.js";
import { startDiscordModeration } from "./moderation.js";
import { logger } from "../lib/logger.js";

const STORE_MARKER = "Guerra Fria • Loja VIP";
const VIP_KIT_UPDATE_MARKER = "Guerra Fria • Kit VIP • cooldown 8h";
const VIP_KIT_COOLDOWN_HOURS = 8;
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
      "⏱️ **Cooldown do Kit VIP:** agora são apenas **8 horas** para resgatar novamente.\n\n" +
      "📦 **Importante:** os kits e benefícios podem ser ajustados ao longo do tempo para manter o equilíbrio do servidor.",
    imageEnv: "VIP_BRONZE_IMAGE_URL",
  },
  {
    tier: "prata",
    title: "🥈 VIP Prata",
    description:
      "Apoie o servidor Guerra Fria e receba acesso ao pacote VIP Prata por **30 dias**.\n\n" +
      "Sua compra ajuda diretamente a manter o servidor funcionando, cobrindo hospedagem, infraestrutura e melhorias.\n\n" +
      "⏱️ **Cooldown do Kit VIP:** agora são apenas **8 horas** para resgatar novamente.\n\n" +
      "🎛️ **Novo benefício:** agora o VIP Prata possui o comando **`/presset`** no jogo.\n\n" +
      "📦 **Importante:** os kits e benefícios podem ser ajustados ao longo do tempo para manter o equilíbrio do servidor.",
    imageEnv: "VIP_PRATA_IMAGE_URL",
  },
  {
    tier: "ouro",
    title: "🥇 VIP Ouro",
    description:
      "Apoie o servidor Guerra Fria e receba acesso ao pacote VIP Ouro por **30 dias**.\n\n" +
      "Sua compra ajuda diretamente a manter o servidor funcionando, cobrindo hospedagem, infraestrutura e melhorias.\n\n" +
      "⏱️ **Cooldown do Kit VIP:** agora são apenas **8 horas** para resgatar novamente.\n\n" +
      "🎛️ **Novo benefício:** agora o VIP Ouro possui o comando **`/presset`** no jogo.\n\n" +
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
      { name: "💳 Pagamento", value: "PIX • Mercado Pago • Stripe", inline: true },
    )
    .setFooter({ text: `${STORE_MARKER} • Mercado Pago + Stripe` });

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

async function announceVipKitCooldown(client: Client): Promise<void> {
  const channelId = process.env.DISCORD_ANNOUNCEMENTS_CHANNEL_ID?.trim();
  if (!channelId) {
    logger.warn("VIP Kit cooldown announcement skipped — DISCORD_ANNOUNCEMENTS_CHANNEL_ID not configured");
    return;
  }

  const channel = await client.channels.fetch(channelId).catch(() => null) as TextChannel | null;
  if (!channel?.isTextBased() || !channel.isSendable()) {
    logger.warn({ channelId }, "VIP Kit cooldown announcement channel unavailable");
    return;
  }

  const recent = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  const alreadySent = recent?.some(message =>
    message.author.id === client.user?.id &&
    message.embeds.some(embed => embed.footer?.text?.includes(VIP_KIT_UPDATE_MARKER)),
  );

  if (alreadySent) return;

  const embed = new EmbedBuilder()
    .setColor(0xd6a934)
    .setTitle("⏱️ KIT VIP — COOLDOWN REDUZIDO")
    .setDescription(
      `O cooldown para resgatar novamente o **Kit VIP** agora é de apenas **${VIP_KIT_COOLDOWN_HOURS} horas**.\n\n` +
      "🎁 Aproveite seu benefício VIP com muito menos tempo de espera entre os resgates."
    )
    .setFooter({ text: VIP_KIT_UPDATE_MARKER })
    .setTimestamp();

  await channel.send({ embeds: [embed] });
  logger.info({ channelId }, "VIP Kit cooldown update announced");
}

function registerStoreInteractionHandler(client: Client): void {
  if (storeInteractionHandlerRegistered) return;
  storeInteractionHandlerRegistered = true;

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isButton()) return;

    if (interaction.customId === "vip_pay_stripe") {
      try {
        await handleVipPayStripe(interaction);
      } catch (err) {
        logger.error({ err, customId: interaction.customId }, "Stripe VIP ticket interaction failed");
        try {
          const payload = { content: "❌ Não foi possível gerar o checkout Stripe. Tente novamente.", ephemeral: true };
          if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
          else await interaction.reply(payload);
        } catch {}
      }
      return;
    }

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

async function refreshExistingStorePanel(channel: TextChannel, client: Client): Promise<boolean> {
  const recent = await channel.messages.fetch({ limit: 100 }).catch((err) => {
    logger.warn({ err, channelId: channel.id }, "Could not inspect VIP store messages");
    return null;
  });
  if (!recent) return true;

  const storeMessages = recent.filter(message =>
    message.author.id === client.user?.id &&
    message.embeds.some(embed => embed.footer?.text?.includes(STORE_MARKER)),
  );
  if (!storeMessages.size) return false;

  // O painel pode ter ficado parcialmente apagado: o header pode continuar
  // existindo enquanto uma ou mais cards foram excluídas. Nesse caso, cada
  // card ausente precisa ser recriada, e as existentes devem ser sincronizadas
  // por completo (preço, imagem, descrição e botão).
  let foundCards = 0;

  for (const card of VIP_CARDS) {
    const message = storeMessages.find(item =>
      item.embeds.some(embed => embed.title === card.title),
    );

    if (!message) {
      try {
        const { embed, row } = buildCard(card, true);
        await sendStoreMessage(
          channel,
          { embeds: [embed], components: [row] },
          `repair-card-${card.tier}-with-image`,
        );
        foundCards += 1;
        logger.info({ tier: card.tier, channelId: channel.id }, "Missing VIP store card recreated");
      } catch (err) {
        logger.warn(
          { err, tier: card.tier, channelId: channel.id },
          "VIP card recreation with image failed — retrying without image",
        );

        try {
          const { embed, row } = buildCard(card, false);
          await sendStoreMessage(
            channel,
            { embeds: [embed], components: [row] },
            `repair-card-${card.tier}-without-image`,
          );
          foundCards += 1;
          logger.info(
            { tier: card.tier, channelId: channel.id },
            "Missing VIP store card recreated without image",
          );
        } catch (retryErr) {
          logger.error(
            { err: retryErr, tier: card.tier, channelId: channel.id },
            "VIP store card could not be recreated",
          );
        }
      }
      continue;
    }

    try {
      const { embed, row } = buildCard(card, true);
      await message.edit({ embeds: [embed], components: [row] });
      foundCards += 1;
      logger.info({ tier: card.tier, channelId: channel.id }, "Existing VIP store card refreshed");
    } catch (err) {
      logger.warn(
        { err, tier: card.tier, channelId: channel.id },
        "Could not refresh existing VIP store card — retrying without image",
      );

      try {
        const { embed, row } = buildCard(card, false);
        await message.edit({ embeds: [embed], components: [row] });
        foundCards += 1;
        logger.info(
          { tier: card.tier, channelId: channel.id },
          "Existing VIP store card refreshed without image",
        );
      } catch (retryErr) {
        logger.error(
          { err: retryErr, tier: card.tier, channelId: channel.id },
          "Existing VIP store card could not be refreshed",
        );
      }
    }
  }

  logger.info(
    { channelId: channel.id, repairedOrRefreshed: foundCards, expected: VIP_CARDS.length },
    "VIP store panel synchronization complete",
  );

  return true;
}

export async function setupVipStore(client: Client): Promise<void> {
  registerStoreInteractionHandler(client);
  if (!moderationStarted) {
    startDiscordModeration(client);
    moderationStarted = true;
  }
  await startBoosterSystem(client).catch((err) => logger.error({ err }, "Failed to start booster system"));
  await announceVipKitCooldown(client).catch((err) => logger.error({ err }, "Failed to announce VIP Kit cooldown update"));

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
  if (await refreshExistingStorePanel(channel, client)) {
    logger.info({ channelId }, "Existing VIP store panel refreshed; no cards republished");
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

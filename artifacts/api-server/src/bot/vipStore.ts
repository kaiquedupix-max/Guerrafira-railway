import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type Client,
  type TextChannel,
} from "discord.js";
import { VIP_TIERS, type VipTier } from "./vip.js";
import { logger } from "../lib/logger.js";

const STORE_MARKER = "Guerra Fria • Loja VIP";

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

function buildCard(tier: VipTier, title: string, description: string, imageEnv: string) {
  const vip = VIP_TIERS[tier];
  const embed = new EmbedBuilder()
    .setColor(vip.color)
    .setTitle(title)
    .setDescription(description)
    .addFields(
      { name: "💰 Valor", value: `R$ ${vip.price.toFixed(2)}`, inline: true },
      { name: "⏱️ Duração", value: "30 dias", inline: true },
      { name: "💳 Pagamento", value: "PIX ou Cartão", inline: true },
    )
    .setFooter({ text: `${STORE_MARKER} • Pagamentos via Mercado Pago` });

  const imageUrl = process.env[imageEnv]?.trim();
  if (imageUrl) embed.setImage(imageUrl);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`vip_select_${tier}`)
      .setLabel(`Comprar ${vip.name}`)
      .setEmoji(vip.emoji)
      .setStyle(tier === "ouro" ? ButtonStyle.Success : tier === "prata" ? ButtonStyle.Primary : ButtonStyle.Secondary),
  );

  return { embed, row };
}

export async function setupVipStore(client: Client): Promise<void> {
  const channelId = process.env.DISCORD_VIP_STORE_CHANNEL_ID ?? process.env.DISCORD_VIP_CHANNEL_ID;
  if (!channelId) {
    logger.warn("DISCORD_VIP_STORE_CHANNEL_ID not set — VIP store panel skipped");
    return;
  }

  const channel = await client.channels.fetch(channelId).catch(() => null) as TextChannel | null;
  if (!channel?.isTextBased()) {
    logger.warn({ channelId }, "VIP store channel not found or is not a text channel");
    return;
  }

  const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  if (recent) {
    const oldStoreMessages = recent.filter((message) =>
      message.author.id === client.user?.id &&
      message.embeds.some((embed) => embed.footer?.text?.includes(STORE_MARKER)),
    );
    for (const message of oldStoreMessages.values()) {
      await message.delete().catch(() => {});
    }
  }

  const header = new EmbedBuilder()
    .setColor(0x111827)
    .setTitle("👑 Loja VIP — Guerra Fria")
    .setDescription(
      "Escolha abaixo o VIP que deseja adquirir. Cada opção possui seu próprio botão de compra.\n\n" +
      "Ao comprar um VIP, você **ajuda a manter o servidor funcionando** e contribui para custos de hospedagem, infraestrutura e futuras melhorias.",
    )
    .setFooter({ text: `${STORE_MARKER} • Compra segura e ativação automática` });

  await channel.send({ embeds: [header] });

  for (const card of VIP_CARDS) {
    const { embed, row } = buildCard(card.tier, card.title, card.description, card.imageEnv);
    await channel.send({ embeds: [embed], components: [row] });
  }

  logger.info({ channelId }, "VIP store panel ready");
}

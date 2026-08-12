import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  type ButtonInteraction,
  type TextChannel,
} from "discord.js";
import { VIP_TIERS, type VipTier } from "./vip.js";
import { logger } from "../lib/logger.js";

function isVipTier(value: string): value is VipTier {
  return value === "bronze" || value === "prata" || value === "ouro";
}

export async function handleVipStoreBuy(interaction: ButtonInteraction): Promise<void> {
  const rawTier = interaction.customId.replace("vip_store_buy_", "");
  if (!isVipTier(rawTier)) return;

  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({ content: "❌ Não foi possível identificar o servidor.", ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const vip = VIP_TIERS[rawTier];
  const safeName = interaction.user.username.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 16) || "usuario";

  // Reutiliza um ticket VIP já aberto pelo mesmo usuário, evitando spam de canais.
  const existing = guild.channels.cache.find((channel) =>
    channel.type === ChannelType.GuildText &&
    channel.name.startsWith("ticket-vip-") &&
    channel.topic?.endsWith(`| ${interaction.user.id}`),
  ) as TextChannel | undefined;

  if (existing) {
    await interaction.editReply(
      `🎫 Você já possui um ticket de compra aberto. **Clique aqui para acessar:** <#${existing.id}>`,
    );
    return;
  }

  await guild.roles.fetch();
  const adminRoles = guild.roles.cache.filter((role) => role.permissions.has(PermissionFlagsBits.Administrator));
  const categoryId = process.env.DISCORD_TICKETS_CATEGORY_ID;

  try {
    const ticketChannel = await guild.channels.create({
      name: `ticket-vip-${rawTier}-${safeName}`,
      type: ChannelType.GuildText,
      parent: categoryId ?? undefined,
      topic: `👑 Comprar ${vip.name} | ${interaction.user.tag} | ${interaction.user.id}`,
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
        ...adminRoles.map((role) => ({
          id: role.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.ManageMessages,
          ],
        })),
      ],
    }) as TextChannel;

    const embed = new EmbedBuilder()
      .setColor(vip.color)
      .setTitle(`${vip.emoji} Compra do ${vip.name}`)
      .setDescription(
        `Olá, <@${interaction.user.id}>! Seu ticket de compra foi criado para o **${vip.name}**.\n\n` +
        `**Valor:** R$ ${vip.price.toFixed(2)}\n` +
        `**Duração:** 30 dias\n` +
        `**Pagamento:** PIX ou Cartão\n\n` +
        `Clique em **Continuar compra** abaixo. O bot vai pedir seu **SteamID64** e **e-mail** e, em seguida, você escolhe a forma de pagamento.`,
      )
      .setFooter({ text: "Guerra Fria • Loja VIP • Mercado Pago" })
      .setTimestamp();

    const purchaseRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`vip_select_${rawTier}`)
        .setLabel(`Continuar compra do ${vip.name}`)
        .setEmoji(vip.emoji)
        .setStyle(rawTier === "ouro" ? ButtonStyle.Success : rawTier === "prata" ? ButtonStyle.Primary : ButtonStyle.Secondary),
    );

    const closeRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("ticket_close")
        .setLabel("🔒 Fechar Ticket")
        .setStyle(ButtonStyle.Danger),
    );

    await ticketChannel.send({
      content: `<@${interaction.user.id}>`,
      embeds: [embed],
      components: [purchaseRow, closeRow],
    });

    await interaction.editReply(
      `✅ **Ticket de compra do ${vip.name} criado!**\n\n` +
      `👉 **Clique aqui para ir ao ticket e finalizar a compra:** <#${ticketChannel.id}>`,
    );

    logger.info({
      tier: rawTier,
      userId: interaction.user.id,
      channelId: ticketChannel.id,
    }, "VIP store purchase ticket created");
  } catch (err) {
    logger.error({ err, tier: rawTier, userId: interaction.user.id }, "Failed to create VIP store purchase ticket");
    await interaction.editReply(
      "❌ Não consegui criar seu ticket de compra. Verifique as permissões do bot ou tente novamente em alguns instantes.",
    );
  }
}

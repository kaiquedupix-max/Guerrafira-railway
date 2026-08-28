import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  Events,
  PermissionFlagsBits,
  type ButtonInteraction,
  type Client,
  type GuildMember,
  type Message,
  type TextChannel,
} from "discord.js";
import { logger } from "../lib/logger.js";

const DEFAULT_MOD_ROLE_ID = "1538735197611360347";
const modRoleId = () => String(process.env.DISCORD_MOD_ROLE_ID || DEFAULT_MOD_ROLE_ID).trim();
const ticketCategoryId = () => String(process.env.DISCORD_TICKETS_CATEGORY_ID || "").trim();
const CLAIM_FOOTER = "Guerra Fria • Controle de atendimento";

function isTicketChannel(channel: TextChannel): boolean {
  const category = ticketCategoryId();
  return channel.type === ChannelType.GuildText && channel.name.startsWith("ticket-") && (!category || channel.parentId === category);
}

function openerId(channel: TextChannel): string | null {
  const topic = channel.topic ?? "";
  const parts = topic.split(" | ");
  const id = parts[parts.length - 1]?.trim();
  return /^\d{15,22}$/.test(id ?? "") ? id! : null;
}

async function moderatorRolePosition(channel: TextChannel): Promise<number | null> {
  await channel.guild.roles.fetch().catch(() => null);
  const role = channel.guild.roles.cache.get(modRoleId());
  return role?.position ?? null;
}

async function isStaff(member: GuildMember, channel: TextChannel): Promise<boolean> {
  const modPosition = await moderatorRolePosition(channel);
  if (modPosition === null) return member.roles.cache.has(modRoleId());
  return member.roles.cache.some((role) => role.id !== channel.guild.roles.everyone.id && role.position >= modPosition);
}

function isAdministrator(member: GuildMember): boolean {
  return member.permissions.has(PermissionFlagsBits.Administrator);
}

function claimedMemberId(channel: TextChannel): string | null {
  const opener = openerId(channel);
  const botId = channel.client.user?.id;
  for (const overwrite of channel.permissionOverwrites.cache.values()) {
    if (overwrite.type !== 1) continue;
    if (overwrite.id === opener || overwrite.id === botId) continue;
    if (overwrite.allow.has(PermissionFlagsBits.SendMessages)) return overwrite.id;
  }
  return null;
}

function claimRow(claimedBy?: string | null): ActionRowBuilder<ButtonBuilder> {
  const claimed = Boolean(claimedBy);
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("ticket_claim")
      .setLabel(claimed ? "✅ Ticket em atendimento" : "🎟️ Atender Ticket")
      .setStyle(claimed ? ButtonStyle.Success : ButtonStyle.Primary)
      .setDisabled(claimed),
  );
}

function isClaimControlMessage(message: Message): boolean {
  if (message.author.id !== message.channel.client.user?.id) return false;
  const hasButton = message.components.some((row) => row.components.some((component: any) =>
    component?.customId === "ticket_claim" || component?.data?.customId === "ticket_claim",
  ));
  const hasFooter = message.embeds.some((embed) => embed.footer?.text === CLAIM_FOOTER);
  const hasKnownTitle = message.embeds.some((embed) => embed.title === "✅ Ticket em atendimento" || embed.title === "🎟️ Aguardando atendimento");
  return hasButton || (hasFooter && hasKnownTitle);
}

async function ensureClaimMessage(channel: TextChannel): Promise<void> {
  const recent = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  const controls = recent ? [...recent.values()].filter(isClaimControlMessage).sort((a, b) => b.createdTimestamp - a.createdTimestamp) : [];
  const existing = controls[0] ?? null;
  const claimedBy = claimedMemberId(channel);
  const embed = new EmbedBuilder()
    .setColor(claimedBy ? 0x2ecc71 : 0xf1c40f)
    .setTitle(claimedBy ? "✅ Ticket em atendimento" : "🎟️ Aguardando atendimento")
    .setDescription(
      claimedBy
        ? `Este ticket está sendo atendido por <@${claimedBy}>.\n\nAdministradores podem responder normalmente. Moderadores precisam ser o responsável pelo atendimento.`
        : "Moderadores e cargos acima podem visualizar este ticket. Para responder ao jogador, moderadores devem clicar em **Atender Ticket**. Administradores podem responder sem assumir.",
    )
    .setFooter({ text: CLAIM_FOOTER });

  if (existing) await existing.edit({ embeds: [embed], components: [claimRow(claimedBy)] }).catch(() => {});
  else await channel.send({ embeds: [embed], components: [claimRow(claimedBy)] }).catch(() => {});

  for (const duplicate of controls.slice(1)) {
    await duplicate.delete().catch(() => {});
  }
}

async function configureTicketChannel(channel: TextChannel): Promise<void> {
  if (!isTicketChannel(channel)) return;
  const position = await moderatorRolePosition(channel);
  if (position === null) {
    logger.warn({ roleId: modRoleId(), channelId: channel.id }, "Moderator role not found for ticket permissions");
    return;
  }

  const roles = channel.guild.roles.cache.filter((role) =>
    role.id !== channel.guild.roles.everyone.id &&
    role.position >= position &&
    !role.managed,
  );

  for (const role of roles.values()) {
    const adminRole = role.permissions.has(PermissionFlagsBits.Administrator);
    await channel.permissionOverwrites.edit(role.id, {
      ViewChannel: true,
      ReadMessageHistory: true,
      AttachFiles: true,
      EmbedLinks: true,
      ManageMessages: true,
      SendMessages: adminRole ? true : false,
    }, { reason: adminRole ? "Guerra Fria: administradores podem responder qualquer ticket" : "Guerra Fria: moderadores respondem somente após assumir atendimento" }).catch((err) => {
      logger.warn({ err, channelId: channel.id, roleId: role.id }, "Failed to configure ticket staff overwrite");
    });
  }

  const claimedBy = claimedMemberId(channel);
  if (claimedBy) {
    await channel.permissionOverwrites.edit(claimedBy, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true,
      AttachFiles: true,
      EmbedLinks: true,
      ManageMessages: true,
    }, { reason: "Guerra Fria: responsável pelo atendimento" }).catch(() => {});
  }

  await ensureClaimMessage(channel);
}

export async function handleTicketClaim(interaction: ButtonInteraction): Promise<void> {
  const channel = interaction.channel;
  if (!channel || channel.type !== ChannelType.GuildText || !isTicketChannel(channel)) {
    await interaction.reply({ content: "❌ Este botão só funciona dentro de tickets.", ephemeral: true });
    return;
  }

  const member = interaction.member as GuildMember | null;
  if (!member || !(await isStaff(member, channel))) {
    await interaction.reply({ content: "❌ Apenas moderadores e cargos acima podem atender tickets.", ephemeral: true });
    return;
  }

  if (isAdministrator(member)) {
    await interaction.reply({ content: "✅ Como administrador, você já pode responder este ticket sem precisar assumir o atendimento.", ephemeral: true });
    return;
  }

  const current = claimedMemberId(channel);
  if (current && current !== interaction.user.id) {
    await interaction.reply({ content: `⚠️ Este ticket já está sendo atendido por <@${current}>.`, ephemeral: true });
    return;
  }
  if (current === interaction.user.id) {
    await interaction.reply({ content: "✅ Você já está atendendo este ticket.", ephemeral: true });
    return;
  }

  await channel.permissionOverwrites.edit(interaction.user.id, {
    ViewChannel: true,
    SendMessages: true,
    ReadMessageHistory: true,
    AttachFiles: true,
    EmbedLinks: true,
    ManageMessages: true,
  }, { reason: `Ticket assumido por ${interaction.user.tag}` });

  await interaction.update({
    embeds: [
      new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle("✅ Ticket em atendimento")
        .setDescription(`Atendimento assumido por <@${interaction.user.id}>.\n\nModeradores que não assumiram continuam sem poder responder. Administradores podem participar do atendimento normalmente.`)
        .setFooter({ text: CLAIM_FOOTER }),
    ],
    components: [claimRow(interaction.user.id)],
  });

  await channel.send({ content: `👋 <@${interaction.user.id}> assumiu este atendimento.`, allowedMentions: { users: [interaction.user.id] } }).catch(() => {});
  logger.info({ channelId: channel.id, staffId: interaction.user.id, staff: interaction.user.tag }, "Ticket claimed");
}

async function enforceStaffMessage(message: Message): Promise<void> {
  if (!message.guild || message.author.bot || message.channel.type !== ChannelType.GuildText) return;
  const channel = message.channel as TextChannel;
  if (!isTicketChannel(channel)) return;
  if (message.author.id === openerId(channel)) return;
  const member = message.member;
  if (!member || !(await isStaff(member, channel))) return;
  if (isAdministrator(member)) return;

  const claimedBy = claimedMemberId(channel);
  if (claimedBy === message.author.id) return;

  await message.delete().catch(() => {});
  await message.author.send(
    claimedBy
      ? `Esse ticket já está sendo atendido por outro membro da equipe. Canal: #${channel.name}`
      : `Para responder em #${channel.name}, clique primeiro no botão **Atender Ticket**.`,
  ).catch(() => {});
}

export async function setupTicketClaimSystem(client: Client): Promise<void> {
  if ((client as any).__guerraFriaTicketClaimReady) return;
  (client as any).__guerraFriaTicketClaimReady = true;

  const category = ticketCategoryId();
  for (const guild of client.guilds.cache.values()) {
    await guild.roles.fetch().catch(() => null);
    const tickets = guild.channels.cache.filter((channel) =>
      channel.type === ChannelType.GuildText &&
      channel.name.startsWith("ticket-") &&
      (!category || channel.parentId === category),
    );
    for (const channel of tickets.values()) await configureTicketChannel(channel as TextChannel).catch(() => {});
  }

  client.on(Events.ChannelCreate, (channel) => {
    if (channel.type !== ChannelType.GuildText) return;
    setTimeout(() => configureTicketChannel(channel as TextChannel).catch((err) => logger.error({ err }, "Ticket claim channel setup failed")), 500);
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isButton() || interaction.customId !== "ticket_claim") return;
    await handleTicketClaim(interaction).catch((err) => logger.error({ err }, "Ticket claim interaction failed"));
  });

  client.on(Events.MessageCreate, (message) => {
    enforceStaffMessage(message).catch((err) => logger.error({ err }, "Ticket staff message enforcement failed"));
  });

  logger.info({ moderatorRoleId: modRoleId(), categoryId: category || null }, "Ticket claim system initialized");
}

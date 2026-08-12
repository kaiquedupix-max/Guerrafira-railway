import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type Client,
  type GuildMember,
  type ModalSubmitInteraction,
  type TextChannel,
} from "discord.js";
import { db, boosterLinksTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { executeRconCommand } from "./utils/rcon.js";
import { logger } from "../lib/logger.js";

const PANEL_MARKER = "Guerra Fria • Verificação Booster";
const DEFAULT_BOOSTER_IMAGE_URL = "https://raw.githubusercontent.com/kaiquedupix-max/Imagens-gf/refs/heads/main/EBC01249-5174-40E9-B18B-8841D151C1A5.png";
let started = false;

function grantCommand(steamId: string): string {
  const template = process.env.BOOSTER_GAME_ADD_CMD?.trim() || "oxide.grant user {steamid} vip4";
  return template.replace(/\{steam[Ii][Dd]\}/g, steamId);
}

function revokeCommand(steamId: string): string {
  const template = process.env.BOOSTER_GAME_REMOVE_CMD?.trim() || "oxide.revoke user {steamid} vip4";
  return template.replace(/\{steam[Ii][Dd]\}/g, steamId);
}

async function setupPanel(client: Client): Promise<void> {
  const channelId = process.env.DISCORD_BOOSTER_CHANNEL_ID?.trim();
  if (!channelId) { logger.warn("DISCORD_BOOSTER_CHANNEL_ID not set — booster panel disabled"); return; }
  const channel = await client.channels.fetch(channelId).catch(() => null) as TextChannel | null;
  if (!channel?.isSendable()) { logger.error({ channelId }, "Booster panel channel unavailable"); return; }

  const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  const old = recent?.find(m => m.author.id === client.user?.id && m.embeds.some(e => e.footer?.text?.includes(PANEL_MARKER)));
  const boosterImageUrl = process.env.BOOSTER_IMAGE_URL?.trim() || DEFAULT_BOOSTER_IMAGE_URL;

  const embed = new EmbedBuilder()
    .setColor(0x9b30ff)
    .setTitle("🚀 VERIFICAR BOOSTER")
    .setDescription(
      "Impulsiona o **Discord Guerra Fria**? Verifique seu Booster e libere benefícios exclusivos enquanto seu impulso estiver ativo.\n\n" +
      "**🎁 VANTAGENS DE SER BOOSTER**\n\n" +
      "🗺️ **Participar da votação dos mapas**\n" +
      "Tenha acesso às votações exclusivas e ajude a decidir os mapas do próximo wipe.\n\n" +
      "⚡ **Pular a fila**\n" +
      "Tenha prioridade para entrar no servidor quando houver fila.\n\n" +
      "📦 **Kit Booster in-game**\n" +
      "Receba acesso ao kit exclusivo dentro do Rust utilizando o comando **`/kit booster`**.\n\n" +
      "**🔍 COMO VERIFICAR**\n" +
      "🚀 Esteja impulsionando o servidor no momento da verificação.\n" +
      "🎮 Clique em **Verificar Booster** e informe seu **SteamID64**.\n" +
      "✅ Após a confirmação, o benefício **VIP4** será liberado automaticamente no servidor.\n\n" +
      "⚠️ Se você deixar de impulsionar o Discord, os benefícios Booster serão removidos automaticamente."
    )
    .setImage(boosterImageUrl)
    .setFooter({ text: PANEL_MARKER });

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("booster_verify")
      .setLabel("Verificar Booster")
      .setEmoji("🚀")
      .setStyle(ButtonStyle.Primary)
  );

  if (old) await old.edit({ embeds: [embed], components: [row] });
  else await channel.send({ embeds: [embed], components: [row] });
}

export async function handleBoosterVerifyButton(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.guild) return;
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member?.premiumSince) {
    await interaction.reply({ content: "❌ Você não está impulsionando o servidor no momento. Inicie o Booster e tente novamente.", ephemeral: true }); return;
  }
  const modal = new ModalBuilder().setCustomId("booster_verify_modal").setTitle("Verificar Booster");
  const steam = new TextInputBuilder().setCustomId("steamid").setLabel("Seu SteamID64").setPlaceholder("7656119XXXXXXXXXX").setMinLength(17).setMaxLength(17).setRequired(true).setStyle(TextInputStyle.Short);
  modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(steam));
  await interaction.showModal(modal);
}

export async function handleBoosterVerifyModal(interaction: ModalSubmitInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });
  if (!interaction.guild) return;
  const steamId = interaction.fields.getTextInputValue("steamid").trim();
  if (!/^\d{17}$/.test(steamId)) { await interaction.editReply("❌ SteamID64 inválido. Informe exatamente os 17 números."); return; }
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member?.premiumSince) { await interaction.editReply("❌ Seu Booster não está ativo no Discord."); return; }

  const existing = await db.select().from(boosterLinksTable).where(eq(boosterLinksTable.discordUserId, interaction.user.id));
  if (existing.length) await db.update(boosterLinksTable).set({ steamId, active: true, updatedAt: new Date() }).where(eq(boosterLinksTable.discordUserId, interaction.user.id));
  else await db.insert(boosterLinksTable).values({ discordUserId: interaction.user.id, steamId, active: true, updatedAt: new Date() });

  await executeRconCommand(grantCommand(steamId));
  await interaction.editReply(`🚀 **Booster verificado com sucesso!**\n\n🎮 SteamID: \`${steamId}\`\n🎁 Benefício **VIP4** concedido no Guerra Fria.\n📦 Use **/kit booster** dentro do jogo para resgatar seu kit.\n\nEnquanto você continuar impulsionando o Discord, seus benefícios permanecerão ativos.`);
}

async function syncOne(client: Client, discordUserId: string, steamId: string, previouslyActive: boolean): Promise<void> {
  const guildId = process.env.DISCORD_GUILD_ID?.trim(); if (!guildId) return;
  const guild = await client.guilds.fetch(guildId).catch(() => null); if (!guild) return;
  const member = await guild.members.fetch(discordUserId).catch(() => null);
  const boosting = Boolean(member?.premiumSince);
  if (boosting) {
    if (!previouslyActive) await db.update(boosterLinksTable).set({ active: true, updatedAt: new Date() }).where(eq(boosterLinksTable.discordUserId, discordUserId));
    await executeRconCommand(grantCommand(steamId)).catch(() => null);
  } else if (previouslyActive) {
    await executeRconCommand(revokeCommand(steamId)).catch(() => null);
    await db.update(boosterLinksTable).set({ active: false, updatedAt: new Date() }).where(eq(boosterLinksTable.discordUserId, discordUserId));
    logger.info({ discordUserId, steamId }, "Booster ended; VIP4 revoked");
  }
}

async function syncAll(client: Client): Promise<void> {
  const links = await db.select().from(boosterLinksTable);
  for (const link of links) await syncOne(client, link.discordUserId, link.steamId, link.active).catch(err => logger.error({ err, discordUserId: link.discordUserId }, "Booster sync failed"));
}

export async function startBoosterSystem(client: Client): Promise<void> {
  if (started) return; started = true;
  await setupPanel(client);
  await syncAll(client).catch(err => logger.error({ err }, "Initial booster sync failed"));
  setInterval(() => syncAll(client).catch(err => logger.error({ err }, "Booster sync failed")), 2 * 60_000);
  logger.info("Booster verification panel and automatic VIP4 sync started");
}

import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, Events, ModalBuilder,
  TextInputBuilder, TextInputStyle, type ButtonInteraction, type Client,
  type ModalSubmitInteraction, type TextChannel,
} from "discord.js";
import { db, boosterLinksTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { executeRconCommand } from "./utils/rcon.js";
import { logger } from "../lib/logger.js";

const PANEL_MARKER = "Guerra Fria • Verificação Booster";
const DEFAULT_BOOSTER_CHANNEL_ID = "1499084541548298412";
const DEFAULT_BOOSTER_IMAGE_URL = "https://raw.githubusercontent.com/kaiquedupix-max/Imagens-gf/refs/heads/main/EBC01249-5174-40E9-B18B-8841D151C1A5.png";
let started = false;

function grantCommand(steamId: string): string {
  const template = process.env.BOOSTER_GAME_ADD_CMD?.trim() || "oxide.usergroup add {steamid} bs";
  return template.replace(/\{steam[Ii][Dd]\}/g, steamId);
}
function revokeCommand(steamId: string): string {
  const template = process.env.BOOSTER_GAME_REMOVE_CMD?.trim() || "oxide.usergroup remove {steamid} bs";
  return template.replace(/\{steam[Ii][Dd]\}/g, steamId);
}

async function setupPanel(client: Client): Promise<void> {
  const channelId = process.env.DISCORD_BOOSTER_CHANNEL_ID?.trim() || DEFAULT_BOOSTER_CHANNEL_ID;
  logger.info({ channelId }, "Initializing Booster verification panel");
  const channel = await client.channels.fetch(channelId).catch((err) => { logger.error({ err, channelId }, "Failed to fetch Booster panel channel"); return null; }) as TextChannel | null;
  if (!channel?.isTextBased() || !channel.isSendable()) { logger.error({ channelId }, "Booster panel channel not found or bot cannot send messages there"); return; }
  const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  const old = recent?.find(m => m.author.id === client.user?.id && m.embeds.some(e => e.footer?.text?.includes(PANEL_MARKER)));
  const boosterImageUrl = process.env.BOOSTER_IMAGE_URL?.trim() || DEFAULT_BOOSTER_IMAGE_URL;
  const embed = new EmbedBuilder().setColor(0x9b30ff).setTitle("🚀 VERIFICAR BOOSTER").setDescription(
    "Impulsiona o **Discord Guerra Fria**? Verifique seu Booster e libere benefícios exclusivos enquanto seu impulso estiver ativo.\n\n" +
    "**🎁 VANTAGENS DE SER BOOSTER**\n\n🗺️ **Participar da votação dos mapas**\nTenha acesso às votações exclusivas e ajude a decidir os mapas do próximo wipe.\n\n" +
    "⚡ **Pular a fila**\nTenha prioridade para entrar no servidor quando houver fila.\n\n📦 **Kit Booster in-game**\nReceba acesso ao kit exclusivo dentro do Rust utilizando o comando **`/kit`**.\n\n" +
    "**🔍 COMO VERIFICAR**\n🚀 Esteja impulsionando o servidor no momento da verificação.\n🎮 Na primeira vez, informe seu **SteamID64**. Se sua conta já possui uma Steam vinculada, ela será usada automaticamente.\n✅ Após a confirmação, o **Booster será ativado no jogo** automaticamente.\n\n" +
    "⚠️ A Steam vinculada não pode ser alterada pelo painel. Se precisar trocar o SteamID, abra um ticket com a administração.\n⚠️ Se você deixar de impulsionar o Discord, os benefícios Booster serão removidos automaticamente, mas o vínculo Steam será mantido."
  ).setImage(boosterImageUrl).setFooter({ text: PANEL_MARKER });
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId("booster_verify").setLabel("Verificar Booster").setEmoji("🚀").setStyle(ButtonStyle.Primary));
  if (old) await old.edit({ embeds: [embed], components: [row] }); else await channel.send({ embeds: [embed], components: [row] });
}

async function getDiscordLink(discordUserId: string) { const rows = await db.select().from(boosterLinksTable).where(eq(boosterLinksTable.discordUserId, discordUserId)); return rows[0] ?? null; }
async function getSteamLink(steamId: string) { const rows = await db.select().from(boosterLinksTable).where(eq(boosterLinksTable.steamId, steamId)); return rows[0] ?? null; }

export async function handleBoosterVerifyButton(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.guild) return;
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member?.premiumSince) { await interaction.reply({ content: "❌ Você não está impulsionando o servidor no momento. Inicie o Booster e tente novamente.", ephemeral: true }); return; }
  const existing = await getDiscordLink(interaction.user.id);
  if (existing) {
    if (existing.manuallyDisabled) {
      await interaction.reply({ content: "🔒 Seu Booster foi desativado pela administração. Abra um ticket para solicitar a reativação.", ephemeral: true });
      return;
    }
    if (existing.active) {
      await interaction.reply({ content: `✅ **Seu Booster já está verificado.**\n\n🎮 SteamID vinculado: \`${existing.steamId}\`\n\n🔒 Por segurança, não é possível trocar o SteamID pelo painel. Se precisar alterar, abra um ticket com a administração.`, ephemeral: true });
      return;
    }
    await interaction.deferReply({ ephemeral: true });
    const result = await executeRconCommand(grantCommand(existing.steamId)).catch(() => null);
    await db.update(boosterLinksTable).set({ active: true, manuallyDisabled: false, updatedAt: new Date() }).where(eq(boosterLinksTable.discordUserId, interaction.user.id));
    await interaction.editReply(`🚀 **Booster ativado com sua Steam vinculada!**\n\n🎮 SteamID: \`${existing.steamId}\`\n${result === null ? "⚠️ Não foi possível confirmar o grupo **bs** via RCON." : "✅ Você foi adicionado ao grupo **bs** no Rust."}\n\n🔒 Para alterar a Steam vinculada, abra um ticket com a administração.`);
    return;
  }
  const modal = new ModalBuilder().setCustomId("booster_verify_modal").setTitle("Verificar Booster");
  const steam = new TextInputBuilder().setCustomId("steamid").setLabel("Seu SteamID64").setPlaceholder("7656119XXXXXXXXXX").setMinLength(17).setMaxLength(17).setRequired(true).setStyle(TextInputStyle.Short);
  modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(steam));
  await interaction.showModal(modal);
}

export async function handleBoosterVerifyModal(interaction: ModalSubmitInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true }); if (!interaction.guild) return;
  const steamId = interaction.fields.getTextInputValue("steamid").trim();
  if (!/^\d{17}$/.test(steamId)) { await interaction.editReply("❌ SteamID64 inválido. Informe exatamente os 17 números."); return; }
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member?.premiumSince) { await interaction.editReply("❌ Seu Booster não está ativo no Discord."); return; }
  const existingDiscord = await getDiscordLink(interaction.user.id);
  if (existingDiscord) { await interaction.editReply(`🔒 Esta conta já possui a Steam \`${existingDiscord.steamId}\` vinculada. Por segurança, não é possível alterar o SteamID por aqui. Abra um ticket com a administração.`); return; }
  const existingSteam = await getSteamLink(steamId);
  if (existingSteam && existingSteam.discordUserId !== interaction.user.id) { await interaction.editReply("❌ Este **SteamID já está vinculado a outra conta do Discord**. Abra um ticket se acredita que isso é um erro."); return; }
  await db.insert(boosterLinksTable).values({ discordUserId: interaction.user.id, steamId, active: true, manuallyDisabled: false, updatedAt: new Date() });
  const command = grantCommand(steamId);
  const result = await executeRconCommand(command).catch((err) => { logger.error({ err, steamId, command }, "Failed to add Booster to Rust group"); return null; });
  await interaction.editReply(`🚀 **Booster verificado com sucesso!**\n\n🎮 SteamID: \`${steamId}\`\n${result === null ? "⚠️ Booster salvo, mas o RCON não confirmou o grupo **bs** no jogo.\n" : "✅ Você foi adicionado ao grupo **bs** no jogo.\n"}📦 Dentro do Rust, use **\`/kit\`** para acessar seu kit.\n\n🔒 Este SteamID ficou vinculado à sua conta do Discord. Para alterá-lo, abra um ticket com a administração.`);
}

async function syncOne(client: Client, discordUserId: string, steamId: string, previouslyActive: boolean, manuallyDisabled: boolean): Promise<void> {
  if (manuallyDisabled || !previouslyActive) return;
  const guildId = process.env.DISCORD_GUILD_ID?.trim(); if (!guildId) return;
  const guild = await client.guilds.fetch(guildId).catch(() => null); if (!guild) return;
  const member = await guild.members.fetch(discordUserId).catch(() => null);
  const boosting = Boolean(member?.premiumSince);
  if (boosting) {
    await executeRconCommand(grantCommand(steamId)).catch((err) => logger.error({ err, discordUserId, steamId }, "Failed to add Booster group during sync"));
  } else if (previouslyActive) {
    await executeRconCommand(revokeCommand(steamId)).catch((err) => logger.error({ err, discordUserId, steamId }, "Failed to remove Booster group during sync"));
    await db.update(boosterLinksTable).set({ active: false, updatedAt: new Date() }).where(eq(boosterLinksTable.discordUserId, discordUserId));
    logger.info({ discordUserId, steamId }, "Booster ended; removed from bs group in-game");
  }
}

async function syncAll(client: Client): Promise<void> {
  const links = await db.select().from(boosterLinksTable);
  for (const link of links) await syncOne(client, link.discordUserId, link.steamId, link.active, link.manuallyDisabled).catch(err => logger.error({ err, discordUserId: link.discordUserId }, "Booster sync failed"));
}

export async function startBoosterSystem(client: Client): Promise<void> {
  if (started) return;
  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.isButton() && interaction.customId === "booster_verify") { await handleBoosterVerifyButton(interaction); return; }
      if (interaction.isModalSubmit() && interaction.customId === "booster_verify_modal") await handleBoosterVerifyModal(interaction);
    } catch (err) { logger.error({ err }, "Booster interaction failed"); }
  });
  await setupPanel(client); started = true;
  await syncAll(client).catch(err => logger.error({ err }, "Initial booster sync failed"));
  setInterval(() => syncAll(client).catch(err => logger.error({ err }, "Booster sync failed")), 2 * 60_000);
  logger.info("Booster verification panel and automatic in-game sync started");
}

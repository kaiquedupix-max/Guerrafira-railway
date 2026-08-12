import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  Events,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type Client,
  type ModalSubmitInteraction,
  type TextChannel,
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
  const template = process.env.BOOSTER_GAME_ADD_CMD?.trim() || "oxide.grant {steamid} bs";
  return template.replace(/\{steam[Ii][Dd]\}/g, steamId);
}

function revokeCommand(steamId: string): string {
  const template = process.env.BOOSTER_GAME_REMOVE_CMD?.trim() || "oxide.revoke {steamid} bs";
  return template.replace(/\{steam[Ii][Dd]\}/g, steamId);
}

async function setupPanel(client: Client): Promise<void> {
  const channelId = process.env.DISCORD_BOOSTER_CHANNEL_ID?.trim() || DEFAULT_BOOSTER_CHANNEL_ID;
  logger.info({ channelId }, "Initializing Booster verification panel");

  const channel = await client.channels.fetch(channelId).catch((err) => {
    logger.error({ err, channelId }, "Failed to fetch Booster panel channel");
    return null;
  }) as TextChannel | null;

  if (!channel?.isTextBased() || !channel.isSendable()) {
    logger.error({ channelId }, "Booster panel channel not found or bot cannot send messages there");
    return;
  }

  const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  const old = recent?.find(m =>
    m.author.id === client.user?.id &&
    m.embeds.some(e => e.footer?.text?.includes(PANEL_MARKER))
  );
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
      "Receba acesso ao kit exclusivo dentro do Rust utilizando o comando **`/kit`**.\n\n" +
      "**🔍 COMO VERIFICAR**\n" +
      "🚀 Esteja impulsionando o servidor no momento da verificação.\n" +
      "🎮 Clique em **Verificar Booster** e informe seu **SteamID64**.\n" +
      "✅ Após a confirmação, o **Booster será ativado no jogo** automaticamente.\n\n" +
      "⚠️ Cada conta do Discord pode vincular apenas **um SteamID**. Se precisar alterar o vínculo, procure a administração.\n" +
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

  if (old) {
    await old.edit({ embeds: [embed], components: [row] });
    logger.info({ channelId, messageId: old.id }, "Booster verification panel updated");
  } else {
    const sent = await channel.send({ embeds: [embed], components: [row] });
    logger.info({ channelId, messageId: sent.id }, "Booster verification panel created");
  }
}

async function getDiscordLink(discordUserId: string) {
  const rows = await db.select().from(boosterLinksTable).where(eq(boosterLinksTable.discordUserId, discordUserId));
  return rows[0] ?? null;
}

async function getSteamLink(steamId: string) {
  const rows = await db.select().from(boosterLinksTable).where(eq(boosterLinksTable.steamId, steamId));
  return rows[0] ?? null;
}

export async function handleBoosterVerifyButton(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.guild) return;

  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member?.premiumSince) {
    await interaction.reply({ content: "❌ Você não está impulsionando o servidor no momento. Inicie o Booster e tente novamente.", ephemeral: true });
    return;
  }

  const existing = await getDiscordLink(interaction.user.id);
  if (existing) {
    await interaction.reply({
      content:
        "✅ **Seu Booster já está verificado.**\n\n" +
        `🎮 SteamID vinculado: \`${existing.steamId}\`\n\n` +
        "Por segurança, não é possível trocar o SteamID pelo painel. Se você realmente precisar alterar o vínculo, abra um ticket com a administração.",
      ephemeral: true,
    });
    return;
  }

  const modal = new ModalBuilder().setCustomId("booster_verify_modal").setTitle("Verificar Booster");
  const steam = new TextInputBuilder()
    .setCustomId("steamid")
    .setLabel("Seu SteamID64")
    .setPlaceholder("7656119XXXXXXXXXX")
    .setMinLength(17)
    .setMaxLength(17)
    .setRequired(true)
    .setStyle(TextInputStyle.Short);
  modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(steam));
  await interaction.showModal(modal);
}

export async function handleBoosterVerifyModal(interaction: ModalSubmitInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });
  if (!interaction.guild) return;

  const steamId = interaction.fields.getTextInputValue("steamid").trim();
  if (!/^\d{17}$/.test(steamId)) {
    await interaction.editReply("❌ SteamID64 inválido. Informe exatamente os 17 números.");
    return;
  }

  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member?.premiumSince) {
    await interaction.editReply("❌ Seu Booster não está ativo no Discord.");
    return;
  }

  const existingDiscord = await getDiscordLink(interaction.user.id);
  if (existingDiscord) {
    await interaction.editReply(
      "✅ **Seu Booster já está verificado.**\n\n" +
      `🎮 SteamID vinculado: \`${existingDiscord.steamId}\`\n\n` +
      "Não é possível alterar o SteamID pelo painel. Abra um ticket com a administração caso precise corrigir o vínculo."
    );
    return;
  }

  const existingSteam = await getSteamLink(steamId);
  if (existingSteam && existingSteam.discordUserId !== interaction.user.id) {
    await interaction.editReply(
      "❌ Este **SteamID já está vinculado a outra conta do Discord**.\n\n" +
      "Se acredita que isso é um erro, abra um ticket com a administração."
    );
    return;
  }

  await db.insert(boosterLinksTable).values({
    discordUserId: interaction.user.id,
    steamId,
    active: true,
    updatedAt: new Date(),
  });

  const command = grantCommand(steamId);
  const result = await executeRconCommand(command).catch((err) => {
    logger.error({ err, steamId, command }, "Failed to grant Booster permission in Rust");
    return null;
  });

  await interaction.editReply(
    `🚀 **Booster verificado com sucesso!**\n\n` +
    `🎮 SteamID: \`${steamId}\`\n` +
    (result === null
      ? "⚠️ Booster salvo, mas o RCON não confirmou a permissão **bs** no jogo.\n"
      : "✅ Seu **Booster foi ativado no jogo** com a permissão **bs**.\n") +
    "📦 Dentro do Rust, use **`/kit`** para acessar seu kit.\n\n" +
    "🔒 Este SteamID ficou vinculado à sua conta do Discord.\n" +
    "Enquanto você continuar impulsionando o Discord, seus benefícios permanecerão ativos."
  );
}

async function syncOne(client: Client, discordUserId: string, steamId: string, previouslyActive: boolean): Promise<void> {
  const guildId = process.env.DISCORD_GUILD_ID?.trim();
  if (!guildId) return;

  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return;

  const member = await guild.members.fetch(discordUserId).catch(() => null);
  const boosting = Boolean(member?.premiumSince);

  if (boosting) {
    if (!previouslyActive) {
      await db.update(boosterLinksTable)
        .set({ active: true, updatedAt: new Date() })
        .where(eq(boosterLinksTable.discordUserId, discordUserId));
    }
    await executeRconCommand(grantCommand(steamId)).catch((err) =>
      logger.error({ err, discordUserId, steamId }, "Failed to grant Booster permission during sync")
    );
  } else if (previouslyActive) {
    await executeRconCommand(revokeCommand(steamId)).catch((err) =>
      logger.error({ err, discordUserId, steamId }, "Failed to revoke Booster permission during sync")
    );
    await db.update(boosterLinksTable)
      .set({ active: false, updatedAt: new Date() })
      .where(eq(boosterLinksTable.discordUserId, discordUserId));
    logger.info({ discordUserId, steamId }, "Booster ended; bs permission revoked in-game");
  }
}

async function syncAll(client: Client): Promise<void> {
  const links = await db.select().from(boosterLinksTable);
  for (const link of links) {
    await syncOne(client, link.discordUserId, link.steamId, link.active).catch(err =>
      logger.error({ err, discordUserId: link.discordUserId }, "Booster sync failed")
    );
  }
}

export async function startBoosterSystem(client: Client): Promise<void> {
  if (started) return;

  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.isButton() && interaction.customId === "booster_verify") {
        await handleBoosterVerifyButton(interaction);
        return;
      }
      if (interaction.isModalSubmit() && interaction.customId === "booster_verify_modal") {
        await handleBoosterVerifyModal(interaction);
      }
    } catch (err) {
      logger.error({ err }, "Booster interaction failed");
    }
  });

  await setupPanel(client);
  started = true;

  await syncAll(client).catch(err => logger.error({ err }, "Initial booster sync failed"));
  setInterval(() => syncAll(client).catch(err => logger.error({ err }, "Booster sync failed")), 2 * 60_000);
  logger.info("Booster verification panel and automatic in-game sync started");
}

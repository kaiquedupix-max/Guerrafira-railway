import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Client,
  type GuildMember,
} from "discord.js";
import { db, boosterLinksTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { executeRconCommand } from "./utils/rcon.js";
import { logger } from "../lib/logger.js";

let started = false;

function gameCommand(template: string | undefined, steamId: string): string | null {
  if (!template?.trim()) return null;
  return template.replace(/\{steam[Ii][Dd]\}/g, steamId);
}

async function setBoosterBenefits(member: GuildMember, steamId: string, active: boolean): Promise<void> {
  const customRoleId = process.env.DISCORD_BOOSTER_ROLE_ID?.trim();

  if (customRoleId) {
    try {
      if (active && !member.roles.cache.has(customRoleId)) {
        await member.roles.add(customRoleId, "Sincronização automática de Booster");
      } else if (!active && member.roles.cache.has(customRoleId)) {
        await member.roles.remove(customRoleId, "Impulso do servidor encerrado");
      }
    } catch (err) {
      logger.error({ err, discordUserId: member.id, customRoleId }, "Failed to sync booster Discord role");
    }
  }

  const template = active ? process.env.BOOSTER_GAME_ADD_CMD : process.env.BOOSTER_GAME_REMOVE_CMD;
  const command = gameCommand(template, steamId);
  if (command) {
    await executeRconCommand(command).catch(() => null);
    logger.info({ active, steamId, command }, "Booster game benefit synchronized");
  }
}

async function syncOne(client: Client, discordUserId: string, steamId: string, previouslyActive: boolean): Promise<void> {
  const guildId = process.env.DISCORD_GUILD_ID?.trim();
  if (!guildId) return;

  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return;

  const member = await guild.members.fetch(discordUserId).catch(() => null);
  const boosting = Boolean(member?.premiumSince);

  if (!member) {
    if (previouslyActive) {
      const removeCmd = gameCommand(process.env.BOOSTER_GAME_REMOVE_CMD, steamId);
      if (removeCmd) await executeRconCommand(removeCmd).catch(() => null);
      await db.update(boosterLinksTable).set({ active: false, updatedAt: new Date() }).where(eq(boosterLinksTable.discordUserId, discordUserId));
    }
    return;
  }

  if (boosting !== previouslyActive) {
    await setBoosterBenefits(member, steamId, boosting);
    await db.update(boosterLinksTable).set({ active: boosting, updatedAt: new Date() }).where(eq(boosterLinksTable.discordUserId, discordUserId));
    logger.info({ discordUserId, steamId, boosting }, "Booster status changed");
  } else if (boosting) {
    // Reaplica silenciosamente para recuperar benefícios após restart/wipe do servidor.
    await setBoosterBenefits(member, steamId, true);
  }
}

async function syncAll(client: Client): Promise<void> {
  const links = await db.select().from(boosterLinksTable);
  for (const link of links) {
    await syncOne(client, link.discordUserId, link.steamId, link.active).catch((err) =>
      logger.error({ err, discordUserId: link.discordUserId }, "Booster sync failed")
    );
  }
}

async function handleBoosterCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  if (!interaction.guild) {
    await interaction.editReply("❌ Use este comando dentro do servidor Guerra Fria.");
    return;
  }

  const steamId = interaction.options.getString("steamid", true).trim();
  if (!/^\d{17}$/.test(steamId)) {
    await interaction.editReply("❌ SteamID64 inválido. Informe os 17 números do seu SteamID64.");
    return;
  }

  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member?.premiumSince) {
    await interaction.editReply("❌ Você precisa estar impulsionando o servidor neste momento para ativar o Kit Booster.");
    return;
  }

  const existing = await db.select().from(boosterLinksTable).where(eq(boosterLinksTable.discordUserId, interaction.user.id));
  if (existing.length) {
    await db.update(boosterLinksTable)
      .set({ steamId, active: true, updatedAt: new Date() })
      .where(eq(boosterLinksTable.discordUserId, interaction.user.id));
  } else {
    await db.insert(boosterLinksTable).values({
      discordUserId: interaction.user.id,
      steamId,
      active: true,
      updatedAt: new Date(),
    });
  }

  await setBoosterBenefits(member, steamId, true);
  await interaction.editReply(
    "🚀 **Booster ativado com sucesso!**\n\n" +
    `🎮 SteamID vinculado: \`${steamId}\`\n` +
    "🎁 Seu benefício/Kit Booster foi ativado no servidor.\n\n" +
    "Enquanto você continuar impulsionando o Discord, o benefício será mantido. Se o impulso for encerrado, o cargo personalizado e o acesso in-game serão removidos automaticamente."
  );
}

async function registerCommand(client: Client): Promise<void> {
  const guildId = process.env.DISCORD_GUILD_ID?.trim();
  if (!guildId) return;

  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return;

  const data = new SlashCommandBuilder()
    .setName("booster")
    .setDescription("Vincula seu SteamID e ativa o Kit Booster enquanto você impulsionar o servidor")
    .addStringOption((o) => o.setName("steamid").setDescription("Seu SteamID64 de 17 dígitos").setRequired(true));

  const commands = await guild.commands.fetch().catch(() => null);
  const existing = commands?.find((c) => c.name === "booster");
  if (existing) await existing.edit(data.toJSON()).catch(() => {});
  else await guild.commands.create(data.toJSON()).catch((err) => logger.error({ err }, "Failed to register /booster"));
}

export async function startBoosterSystem(client: Client): Promise<void> {
  if (started) return;
  started = true;

  await registerCommand(client);

  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand() || interaction.commandName !== "booster") return;
    await handleBoosterCommand(interaction).catch((err) => logger.error({ err }, "Booster command failed"));
  });

  await syncAll(client).catch((err) => logger.error({ err }, "Initial booster sync failed"));
  setInterval(() => syncAll(client).catch((err) => logger.error({ err }, "Booster sync failed")), 2 * 60_000);

  logger.info("Automatic booster system started");
}

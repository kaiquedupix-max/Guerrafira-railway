import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, type ChatInputCommandInteraction } from "discord.js";
import { db, boosterLinksTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { executeRconCommand } from "../utils/rcon.js";
import { logger } from "../../lib/logger.js";

export const data = new SlashCommandBuilder()
  .setName("removerbooster")
  .setDescription("Desativa o Booster do jogador")
  .addStringOption((opt) => opt.setName("steamid").setDescription("SteamID64 vinculado ao Booster").setRequired(true).setMinLength(17).setMaxLength(17))
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles);

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const steamId = interaction.options.getString("steamid", true).trim();
  if (!/^\d{17}$/.test(steamId)) {
    await interaction.editReply("❌ SteamID64 inválido. Informe exatamente os 17 números.");
    return;
  }
  const rows = await db.select().from(boosterLinksTable).where(eq(boosterLinksTable.steamId, steamId));
  const link = rows[0];
  if (!link) {
    await interaction.editReply(`❌ O SteamID \`${steamId}\` não está vinculado a nenhuma conta.`);
    return;
  }
  const command = `oxide.usergroup remove ${steamId} bs`;
  const rconOk = await executeRconCommand(command).then(() => true).catch(() => false);
  await db.update(boosterLinksTable).set({ active: false, updatedAt: new Date() }).where(eq(boosterLinksTable.steamId, steamId));
  await interaction.editReply(`✅ Booster desativado para \`${steamId}\`.\n${rconOk ? "🎮 Grupo **bs** removido no Rust." : "⚠️ Não foi possível confirmar a alteração via RCON."}\n🔒 A Steam continua vinculada a <@${link.discordUserId}>. Para trocar o SteamID, é necessário abrir um ticket com a administração.`);
  logger.info({ steamId, discordUserId: link.discordUserId, admin: interaction.user.tag, rconOk }, "Booster disabled; Steam link kept");
}

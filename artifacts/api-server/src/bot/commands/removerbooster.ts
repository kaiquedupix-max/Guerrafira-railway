import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, type ChatInputCommandInteraction } from "discord.js";
import { db, boosterLinksTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { executeRconCommand } from "../utils/rcon.js";
import { logger } from "../../lib/logger.js";

export const data = new SlashCommandBuilder()
  .setName("removerbooster")
  .setDescription("Remove o SteamID vinculado ao Booster e o grupo bs no Rust")
  .addStringOption((opt) =>
    opt.setName("steamid").setDescription("SteamID64 vinculado ao Booster").setRequired(true).setMinLength(17).setMaxLength(17)
  )
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
    await interaction.editReply(`❌ O SteamID \`${steamId}\` não está vinculado a nenhum Booster.`);
    return;
  }

  const command = `oxide.usergroup remove ${steamId} bs`;
  const rconOk = await executeRconCommand(command).then(() => true).catch((err) => {
    logger.error({ err, steamId, command }, "Failed to remove Booster group via command");
    return false;
  });

  await db.delete(boosterLinksTable).where(eq(boosterLinksTable.steamId, steamId));

  await interaction.editReply(
    `✅ **Vínculo Booster removido.**\n\n` +
    `🎮 SteamID: \`${steamId}\`\n` +
    `👤 Discord vinculado: <@${link.discordUserId}>\n` +
    (rconOk ? "🧹 Jogador removido do grupo **bs** no Rust.\n" : "⚠️ Vínculo removido do banco, mas não foi possível confirmar a remoção do grupo **bs** via RCON.\n") +
    "🔓 Esse Discord e esse SteamID poderão ser vinculados novamente no painel Booster."
  );

  logger.info({ steamId, discordUserId: link.discordUserId, admin: interaction.user.tag, rconOk }, "Booster link manually removed");
}

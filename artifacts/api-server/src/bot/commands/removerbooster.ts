import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, type ChatInputCommandInteraction } from "discord.js";
import { db, boosterLinksTable } from "@workspace/db";
import { ActionError } from "../../core/systemActions.js";
import { setBoosterAccess } from "../../core/accessActions.js";
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
  const member = interaction.options.getUser("membro", true);
  try {
    const result = await setBoosterAccess(member.id, false, `Removido por ${interaction.user.tag}`);
    await interaction.editReply(`✅ Booster removido de <@${member.id}> e do grupo **bs** no Rust (Steam \`${result.steamId}\`). A remoção permanecerá até nova ativação manual.`);
  } catch (error) {
    await interaction.editReply(`❌ ${error instanceof ActionError ? error.message : "Falha interna ao remover o Booster."}`);
  }
}

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
  try {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageRoles)) { await interaction.editReply("Sem permissão para gerenciar Boosters."); return; }
    const steamId = interaction.options.getString("steamid", true).trim();
    if (!/^7656119\d{10}$/.test(steamId)) { await interaction.editReply("SteamID64 inválido."); return; }
    const [link] = await db.select().from(boosterLinksTable).where(eq(boosterLinksTable.steamId, steamId)).limit(1);
    if (!link) throw new ActionError("Steam sem Booster vinculado.", 404);
    const result = await setBoosterAccess(link.discordUserId, false, `Removido por ${interaction.user.tag}`);
    await interaction.editReply(`✅ Booster removido de <@${link.discordUserId}> e do grupo **bs** no Rust (Steam \`${result.steamId}\`). A remoção permanecerá até nova ativação manual.`);
  } catch (error) {
    await interaction.editReply(`❌ ${error instanceof ActionError ? error.message : "Falha interna ao remover o Booster."}`);
  }
}

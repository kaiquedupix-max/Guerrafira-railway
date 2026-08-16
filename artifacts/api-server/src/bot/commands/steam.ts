import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
} from "discord.js";
import { db, boosterLinksTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { executeRconCommand } from "../utils/rcon.js";
import { logger } from "../../lib/logger.js";

export const data = new SlashCommandBuilder()
  .setName("steam")
  .setDescription("Gerencia o SteamID vinculado a uma conta do Discord.")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((sub) =>
    sub
      .setName("consultar")
      .setDescription("Consulta o SteamID vinculado a um usuário.")
      .addUserOption((opt) =>
        opt.setName("usuario").setDescription("Usuário do Discord").setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("trocar")
      .setDescription("Troca o SteamID vinculado a um usuário.")
      .addUserOption((opt) =>
        opt.setName("usuario").setDescription("Usuário do Discord").setRequired(true),
      )
      .addStringOption((opt) =>
        opt
          .setName("novo_steamid")
          .setDescription("Novo SteamID64 com 17 dígitos")
          .setRequired(true)
          .setMinLength(17)
          .setMaxLength(17),
      )
      .addStringOption((opt) =>
        opt.setName("motivo").setDescription("Motivo administrativo da alteração").setRequired(false),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("desvincular")
      .setDescription("Remove completamente o SteamID vinculado de um usuário.")
      .addUserOption((opt) =>
        opt.setName("usuario").setDescription("Usuário do Discord").setRequired(true),
      )
      .addStringOption((opt) =>
        opt.setName("motivo").setDescription("Motivo administrativo da remoção").setRequired(false),
      ),
  );

async function byDiscord(discordUserId: string) {
  const [row] = await db
    .select()
    .from(boosterLinksTable)
    .where(eq(boosterLinksTable.discordUserId, discordUserId))
    .limit(1);
  return row ?? null;
}

async function bySteam(steamId: string) {
  const [row] = await db
    .select()
    .from(boosterLinksTable)
    .where(eq(boosterLinksTable.steamId, steamId))
    .limit(1);
  return row ?? null;
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const sub = interaction.options.getSubcommand();
  const user = interaction.options.getUser("usuario", true);
  const current = await byDiscord(user.id);

  if (sub === "consultar") {
    if (!current) {
      await interaction.editReply(
        `ℹ️ <@${user.id}> ainda não possui um SteamID vinculado ao sistema.`,
      );
      return;
    }

    await interaction.editReply(
      `🎮 **Steam vinculada**\n\n` +
      `👤 Discord: <@${user.id}>\n` +
      `🆔 SteamID64: \`${current.steamId}\`\n` +
      `🚀 Booster ativo: **${current.active ? "Sim" : "Não"}**\n\n` +
      `🔒 O próprio usuário não pode alterar este vínculo.`,
    );
    return;
  }

  if (sub === "trocar") {
    const newSteamId = interaction.options.getString("novo_steamid", true).trim();
    const reason = interaction.options.getString("motivo")?.trim() || "Não informado";

    if (!/^7656119\d{10}$/.test(newSteamId)) {
      await interaction.editReply("❌ SteamID64 inválido. Informe um SteamID de 17 dígitos válido.");
      return;
    }

    const owner = await bySteam(newSteamId);
    if (owner && owner.discordUserId !== user.id) {
      await interaction.editReply(
        `❌ O SteamID \`${newSteamId}\` já está vinculado a outra conta do Discord.`,
      );
      return;
    }

    if (current?.steamId === newSteamId) {
      await interaction.editReply(`ℹ️ <@${user.id}> já está vinculado ao SteamID \`${newSteamId}\`.`);
      return;
    }

    const oldSteamId = current?.steamId ?? null;
    const boosterActive = current?.active ?? false;

    if (current) {
      await db
        .update(boosterLinksTable)
        .set({ steamId: newSteamId, updatedAt: new Date() })
        .where(eq(boosterLinksTable.discordUserId, user.id));
    } else {
      await db.insert(boosterLinksTable).values({
        discordUserId: user.id,
        steamId: newSteamId,
        active: false,
        updatedAt: new Date(),
      });
    }

    if (boosterActive && oldSteamId) {
      await executeRconCommand(`c.usergroup remove ${oldSteamId} bs`).catch((err) =>
        logger.error({ err, oldSteamId, userId: user.id }, "Failed to remove old Booster group during Steam change"),
      );
      await executeRconCommand(`c.usergroup add ${newSteamId} bs`).catch((err) =>
        logger.error({ err, newSteamId, userId: user.id }, "Failed to add new Booster group during Steam change"),
      );
    }

    logger.info({
      admin: interaction.user.tag,
      userId: user.id,
      oldSteamId,
      newSteamId,
      boosterActive,
      reason,
    }, "Steam link changed by admin");

    await interaction.editReply(
      `✅ **Steam vinculada alterada pela administração.**\n\n` +
      `👤 Usuário: <@${user.id}>\n` +
      `📤 Steam anterior: ${oldSteamId ? `\`${oldSteamId}\`` : "Nenhuma"}\n` +
      `📥 Nova Steam: \`${newSteamId}\`\n` +
      `📝 Motivo: ${reason}\n` +
      (boosterActive ? `🚀 O grupo Booster **bs** também foi transferido para a nova Steam.\n` : "") +
      `\n🔒 A nova Steam voltou a ficar bloqueada para alteração pelo usuário.`,
    );
    return;
  }

  if (sub === "desvincular") {
    const reason = interaction.options.getString("motivo")?.trim() || "Não informado";

    if (!current) {
      await interaction.editReply(`ℹ️ <@${user.id}> não possui Steam vinculada.`);
      return;
    }

    if (current.active) {
      await executeRconCommand(`c.usergroup remove ${current.steamId} bs`).catch((err) =>
        logger.error({ err, steamId: current.steamId, userId: user.id }, "Failed to remove Booster group before unlink"),
      );
    }

    await db.delete(boosterLinksTable).where(eq(boosterLinksTable.discordUserId, user.id));

    logger.info({
      admin: interaction.user.tag,
      userId: user.id,
      steamId: current.steamId,
      reason,
    }, "Steam link removed by admin");

    await interaction.editReply(
      `✅ **Steam desvinculada pela administração.**\n\n` +
      `👤 Usuário: <@${user.id}>\n` +
      `🎮 Steam removida: \`${current.steamId}\`\n` +
      `📝 Motivo: ${reason}\n\n` +
      `Na próxima ação que exigir SteamID, o usuário poderá vincular uma nova Steam.`,
    );
  }
}

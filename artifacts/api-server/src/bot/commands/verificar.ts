import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  type ChatInputCommandInteraction,
  type AutocompleteInteraction,
} from "discord.js";
import {
  searchPlayers,
  getPlayerBySteamId,
} from "../utils/players.js";
import { buildVerifyEmbed } from "../utils/embeds.js";
import { executeRconCommand } from "../utils/rcon.js";
import { db, modLogsTable } from "@workspace/db";
import { logger } from "../../lib/logger.js";

export const data = new SlashCommandBuilder()
  .setName("verificar")
  .setDescription(
    "Verifica um jogador e concede Verificado no Discord e no Rust"
  )
  .addStringOption((opt) =>
    opt
      .setName("jogador")
      .setDescription("Nome do jogador no servidor (busca pelo nome ou Steam ID)")
      .setRequired(true)
      .setAutocomplete(true)
  )
  .addUserOption((opt) =>
    opt
      .setName("membro")
      .setDescription("Membro do Discord para receber o cargo Verificado")
      .setRequired(true)
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles);

export async function autocomplete(
  interaction: AutocompleteInteraction
): Promise<void> {
  const focused = interaction.options.getFocused();
  const players = await searchPlayers(focused, 25);

  await interaction.respond(
    players.map((p) => ({
      name: `${p.isOnline ? "🟢" : "⚫"} ${p.playerName} — ${p.steamId}`,
      value: p.steamId,
    }))
  );
}

export async function execute(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const steamId = interaction.options.getString("jogador", true);
  const discordUser = interaction.options.getUser("membro", true);

  const player = await getPlayerBySteamId(steamId);
  if (!player) {
    await interaction.editReply(
      "❌ Jogador não encontrado no banco de dados. Verifique se o jogador já entrou no servidor ao menos uma vez."
    );
    return;
  }

  const verifiedRoleId = process.env.DISCORD_VERIFIED_ROLE_ID;
  let roleAssigned = false;

  if (verifiedRoleId && interaction.guild) {
    try {
      const member = await interaction.guild.members.fetch(discordUser.id);
      if (!member.roles.cache.has(verifiedRoleId)) {
        await member.roles.add(verifiedRoleId, `Verificado por ${interaction.user.tag}`);
        roleAssigned = true;
      }
    } catch (err) {
      logger.error({ err, discordUserId: discordUser.id }, "Failed to assign verified role");
      await interaction.editReply(
        `⚠️ Não foi possível atribuir o cargo. Certifique-se de que:\n` +
        `• O bot tem permissão de **Gerenciar Cargos**\n` +
        `• O cargo <@&${verifiedRoleId}> está **abaixo** do cargo do bot na hierarquia`
      );
      return;
    }
  }

  // Concede Verificado no Rust via RCON.
  // Pode ser sobrescrito por VERIFIED_GAME_ADD_CMD, mas este é o padrão oficial do servidor.
  const verifiedGameTemplate = process.env.VERIFIED_GAME_ADD_CMD?.trim() || "oxide.grant {steamid} vr";
  const verifiedGameCommand = verifiedGameTemplate.replace(/\{steam[Ii][Dd]\}/g, player.steamId);
  const rconResult = await executeRconCommand(verifiedGameCommand).catch((err) => {
    logger.error({ err, steamId: player.steamId, command: verifiedGameCommand }, "Failed to grant verified permission in Rust");
    return null;
  });

  await db.insert(modLogsTable).values({
    action: "VERIFICAR",
    steamId: player.steamId,
    playerName: player.playerName,
    reason: `Triagem de anti-cheat concluída — sem irregularidades | Discord: ${discordUser.tag}`,
    adminId: interaction.user.id,
    adminName: interaction.user.tag,
  });

  const logChannelId = process.env.DISCORD_LOG_CHANNEL_ID;
  if (logChannelId) {
    const ch = await interaction.client.channels.fetch(logChannelId).catch(() => null);
    if (ch?.isSendable()) {
      await ch.send({
        embeds: [
          buildVerifyEmbed({
            playerName: player.playerName,
            steamId: player.steamId,
            discordUser,
            admin: interaction.user,
          }),
        ],
      });
    }
  }

  let reply = `✅ **${player.playerName}** verificado com sucesso!\n🛡️ Log enviado ao canal de logs.`;
  if (verifiedRoleId) {
    reply += roleAssigned
      ? `\n🎖️ Cargo <@&${verifiedRoleId}> atribuído a <@${discordUser.id}>.`
      : `\n🎖️ <@${discordUser.id}> já possuía o cargo <@&${verifiedRoleId}>.`;
  } else {
    reply += `\n⚠️ Configure \`DISCORD_VERIFIED_ROLE_ID\` para atribuir o cargo automaticamente no Discord.`;
  }

  if (rconResult === null) {
    reply += `\n⚠️ Não foi possível confirmar o cargo **vr** no Rust porque o RCON está indisponível.`;
  } else {
    reply += `\n🎮 Cargo/permissão **vr** concedido no Rust ao SteamID \`${player.steamId}\`.`;
  }

  await interaction.editReply(reply);

  const adminDisplayName = (interaction.member as { displayName?: string } | null)?.displayName
    ?? interaction.user.displayName;
  await executeRconCommand(
    `say <color=#00FF88>[VERIFICACAO CONCLUIDA]</color> | ` +
    `<color=#FF8800>${player.playerName}</color> foi verificado pelo admin ` +
    `<color=#FF4444>${adminDisplayName}</color> — ` +
    `<color=#00FF88>jogador esta LIMPO</color>`
  ).catch(() => {});

  logger.info(
    {
      steamId: player.steamId,
      playerName: player.playerName,
      discordUserId: discordUser.id,
      roleAssigned,
      verifiedGameCommand,
      admin: interaction.user.tag,
    },
    "Player verified"
  );
}

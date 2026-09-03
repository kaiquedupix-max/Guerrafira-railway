import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  type ChatInputCommandInteraction,
  type AutocompleteInteraction,
} from "discord.js";
import { searchPlayers, getPlayerBySteamId } from "../utils/players.js";
import { grantVip, VIP_TIERS, type VipTier } from "../vip.js";
import { logger } from "../../lib/logger.js";

export const data = new SlashCommandBuilder()
  .setName("darvip")
  .setDescription("Concede VIP a um jogador do servidor.")
  .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
  .addStringOption((opt) =>
    opt
      .setName("jogador")
      .setDescription("Nome ou Steam ID do jogador (online ou offline)")
      .setRequired(true)
      .setAutocomplete(true),
  )
  .addStringOption((opt) =>
    opt
      .setName("tier")
      .setDescription("Nível do VIP")
      .setRequired(true)
      .addChoices(
        { name: "🥉 VIP Bronze", value: "bronze" },
        { name: "🥈 VIP Prata", value: "prata" },
        { name: "🥇 VIP Ouro", value: "ouro" },
      ),
  )
  .addIntegerOption((opt) =>
    opt
      .setName("duracao")
      .setDescription("Duração em dias (ex: 7, 30, 60, 90)")
      .setRequired(true)
      .setMinValue(1)
      .setMaxValue(365),
  )
  .addUserOption((opt) =>
    opt
      .setName("membro")
      .setDescription("Membro do Discord para receber o cargo VIP (opcional)")
      .setRequired(false),
  );

export async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  try {
    const focused = interaction.options.getFocused();
    const players = await searchPlayers(focused, 25);
    await interaction.respond(
      players.map((p) => ({
        name: `${p.isOnline ? "🟢" : "⚫"} ${p.playerName} — ${p.steamId}`.slice(0, 100),
        value: p.steamId,
      })),
    );
  } catch (err) {
    logger.error({ err }, "darvip autocomplete error");
    if (!interaction.responded) await interaction.respond([]).catch(() => {});
  }
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  try {
    const steamId = interaction.options.getString("jogador", true).trim();
    const tier = interaction.options.getString("tier", true) as VipTier;
    const days = interaction.options.getInteger("duracao", true);
    const memberUser = interaction.options.getUser("membro", false);

    if (!/^7656119\d{10}$/.test(steamId)) {
      await interaction.editReply("❌ Steam ID inválido. Selecione o jogador pelo autocomplete.");
      return;
    }

    if (!VIP_TIERS[tier]) {
      await interaction.editReply("❌ Tier de VIP inválido.");
      return;
    }

    const player = await getPlayerBySteamId(steamId);
    if (!player) {
      await interaction.editReply("❌ Jogador não encontrado no banco de dados.");
      return;
    }

    const vip = VIP_TIERS[tier];
    const discordUserId = memberUser?.id ?? "manual";

    await grantVip({
      discordUserId,
      steamId: player.steamId,
      tier,
      durationDays: days,
      source: "purchase",
      client: interaction.client,
    });

    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    const ptBR = new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: "America/Sao_Paulo",
    }).format(expiresAt);

    const embed = new EmbedBuilder()
      .setColor(vip.color)
      .setTitle(`${vip.emoji} VIP Concedido`)
      .addFields(
        { name: "Jogador", value: `**${player.playerName}**`, inline: true },
        { name: "Tier", value: vip.name, inline: true },
        { name: "Steam ID", value: `\`${player.steamId}\``, inline: true },
        { name: "Duração", value: `${days} dias`, inline: true },
        { name: "Expira em", value: ptBR, inline: true },
        { name: "Admin", value: `<@${interaction.user.id}>`, inline: true },
        ...(memberUser ? [{ name: "Discord", value: `<@${memberUser.id}>`, inline: true }] : []),
      )
      .setFooter({ text: "Guerra Fria • VIP Manual" })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
    logger.info({ steamId: player.steamId, playerName: player.playerName, tier, days, admin: interaction.user.tag }, "VIP granted manually");
  } catch (err) {
    logger.error({ err }, "darvip command error");
    const reason = err instanceof Error ? err.message : "erro desconhecido";
    await interaction.editReply({
      content: `❌ Não consegui conceder o VIP. ${reason.slice(0, 300)}`,
      embeds: [],
    }).catch(() => {});
  }
}

import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  type ChatInputCommandInteraction,
  type AutocompleteInteraction,
} from "discord.js";
import { and, eq, gt } from "drizzle-orm";
import { db, vipSubscriptionsTable } from "@workspace/db";
import { revokeVip, VIP_TIERS, type VipTier } from "../vip.js";
import { logger } from "../../lib/logger.js";

export const data = new SlashCommandBuilder()
  .setName("removervip")
  .setDescription("Remove o VIP de um membro manualmente.")
  .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
  .addStringOption((opt) =>
    opt
      .setName("vip")
      .setDescription("Selecione o VIP ativo a remover (por Steam ID ou nome)")
      .setRequired(true)
      .setAutocomplete(true),
  );

export async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const focused = interaction.options.getFocused().toLowerCase();
  const now = new Date();

  const active = await db
    .select()
    .from(vipSubscriptionsTable)
    .where(
      and(
        gt(vipSubscriptionsTable.expiresAt, now),
        eq(vipSubscriptionsTable.gameVipRemoved, false),
      ),
    )
    .limit(25);

  const choices = active
    .filter((s) => {
      if (!focused) return true;
      return (
        s.steamId.includes(focused) ||
        s.discordUserId.includes(focused) ||
        s.vipTier.toLowerCase().includes(focused)
      );
    })
    .slice(0, 25)
    .map((s) => {
      const vip = VIP_TIERS[s.vipTier as VipTier];
      const daysLeft = Math.max(0, Math.ceil((new Date(s.expiresAt).getTime() - now.getTime()) / 86_400_000));
      return {
        name: `${vip?.emoji ?? "⭐"} ${vip?.name ?? s.vipTier} — ${s.steamId} (${daysLeft}d restante)`.slice(0, 100),
        value: String(s.id),
      };
    });

  await interaction.respond(choices);
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const subId = parseInt(interaction.options.getString("vip", true), 10);
  if (isNaN(subId)) {
    await interaction.editReply("❌ Seleção inválida. Use o autocomplete para escolher um VIP ativo.");
    return;
  }

  const [sub] = await db
    .select()
    .from(vipSubscriptionsTable)
    .where(eq(vipSubscriptionsTable.id, subId));

  if (!sub) {
    await interaction.editReply("❌ Registro VIP não encontrado. Pode ter sido removido.");
    return;
  }

  const vip = VIP_TIERS[sub.vipTier as VipTier];

  try {
    await revokeVip({
      subscriptionId: sub.id,
      tier: sub.vipTier as VipTier,
      steamId: sub.steamId,
      discordUserId: sub.discordUserId,
      client: interaction.client,
    });
  } catch (err) {
    logger.error({ err, subId, steamId: sub.steamId }, "removervip command error");
    await interaction.editReply("❌ Ocorreu um erro ao remover o VIP. Verifique os logs internos.");
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle(`${vip?.emoji ?? "⭐"}  VIP Removido`)
    .addFields(
      { name: "Membro", value: `<@${sub.discordUserId}>`, inline: true },
      { name: "Tier", value: vip?.name ?? sub.vipTier, inline: true },
      { name: "Steam ID", value: `\`${sub.steamId}\``, inline: true },
      { name: "Admin", value: `<@${interaction.user.id}>`, inline: true },
    )
    .setFooter({ text: "Guerra Fria • Remoção Manual" })
    .setTimestamp();

  // Apenas quem executou o comando recebe esta confirmação.
  // Não envia VIP para o canal de registros do servidor.
  await interaction.editReply({ embeds: [embed] });
}

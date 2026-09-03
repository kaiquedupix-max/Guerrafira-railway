import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  type ChatInputCommandInteraction,
  type AutocompleteInteraction,
} from "discord.js";
import { and, eq, gt, asc } from "drizzle-orm";
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
      .setDescription("Selecione o VIP ativo a remover (Steam ID, Discord ou tier)")
      .setRequired(true)
      .setAutocomplete(true),
  );

export async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  try {
    const focused = interaction.options.getFocused().toLowerCase().trim();
    const now = new Date();

    // Busca uma faixa maior antes de filtrar. O código antigo limitava a 25
    // registros ANTES do filtro e fazia VIPs válidos simplesmente sumirem.
    const active = await db
      .select()
      .from(vipSubscriptionsTable)
      .where(
        and(
          gt(vipSubscriptionsTable.expiresAt, now),
          eq(vipSubscriptionsTable.gameVipRemoved, false),
        ),
      )
      .orderBy(asc(vipSubscriptionsTable.expiresAt))
      .limit(500);

    const choices = active
      .filter((s) => {
        if (!focused) return true;
        return (
          String(s.steamId || "").toLowerCase().includes(focused) ||
          String(s.discordUserId || "").toLowerCase().includes(focused) ||
          String(s.vipTier || "").toLowerCase().includes(focused)
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
  } catch (err) {
    logger.error({ err }, "removervip autocomplete error");
    if (!interaction.responded) await interaction.respond([]).catch(() => {});
  }
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  try {
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

    const now = new Date();
    if (new Date(sub.expiresAt).getTime() <= now.getTime() || sub.gameVipRemoved) {
      await interaction.editReply("ℹ️ Esse VIP já está expirado ou já foi removido.");
      return;
    }

    const vip = VIP_TIERS[sub.vipTier as VipTier];

    await revokeVip({
      subscriptionId: sub.id,
      tier: sub.vipTier as VipTier,
      steamId: sub.steamId,
      discordUserId: sub.discordUserId,
      client: interaction.client,
    });

    const discordLabel = /^\d{16,22}$/.test(String(sub.discordUserId || ""))
      ? `<@${sub.discordUserId}>`
      : "Sem Discord vinculado";

    const embed = new EmbedBuilder()
      .setColor(0xe74c3c)
      .setTitle(`${vip?.emoji ?? "⭐"} VIP Removido`)
      .addFields(
        { name: "Membro", value: discordLabel, inline: true },
        { name: "Tier", value: vip?.name ?? sub.vipTier, inline: true },
        { name: "Steam ID", value: `\`${sub.steamId}\``, inline: true },
        { name: "Admin", value: `<@${interaction.user.id}>`, inline: true },
      )
      .setFooter({ text: "Guerra Fria • Remoção Manual" })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    logger.error({ err }, "removervip command error");
    await interaction.editReply({ content: "❌ Não consegui remover o VIP. A operação foi interrompida e o erro ficou registrado nos logs.", embeds: [] }).catch(() => {});
  }
}

import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { and, eq, gt, asc } from "drizzle-orm";
import { db, vipSubscriptionsTable } from "@workspace/db";
import { VIP_TIERS } from "../vip.js";

export const data = new SlashCommandBuilder()
  .setName("listvips")
  .setDescription("Lista todos os jogadores com VIP ativo e data de expiração.")
  .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers);

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const now    = new Date();
  const active = await db
    .select()
    .from(vipSubscriptionsTable)
    .where(
      and(
        gt(vipSubscriptionsTable.expiresAt, now),
        eq(vipSubscriptionsTable.gameVipRemoved, false),
      ),
    )
    .orderBy(asc(vipSubscriptionsTable.expiresAt));

  if (!active.length) {
    await interaction.editReply({ content: "📋 Nenhum VIP ativo no momento." });
    return;
  }

  const ptBR = (d: Date) =>
    new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: "America/Sao_Paulo",
    }).format(d);

  const daysLeft = (d: Date) => Math.max(0, Math.ceil((d.getTime() - now.getTime()) / 86_400_000));

  // Group by tier for the summary line
  const tierCount: Record<string, number> = {};
  for (const s of active) tierCount[s.vipTier] = (tierCount[s.vipTier] ?? 0) + 1;

  const summary = Object.entries(tierCount)
    .map(([t, n]) => `${VIP_TIERS[t as keyof typeof VIP_TIERS]?.emoji ?? "⭐"} ${n}× ${VIP_TIERS[t as keyof typeof VIP_TIERS]?.name ?? t}`)
    .join("  •  ");

  // Build field list (max 25 fields per embed)
  const CHUNK = 10;
  const embeds: EmbedBuilder[] = [];

  for (let i = 0; i < active.length; i += CHUNK) {
    const slice = active.slice(i, i + CHUNK);
    const embed = new EmbedBuilder()
      .setColor(0xf39c12)
      .setTitle(i === 0 ? `👑  VIPs Ativos — ${active.length} total` : `👑  VIPs Ativos (continuação)`)
      .setFooter({ text: `Guerra Fria • ${ptBR(now)}` });

    if (i === 0) embed.setDescription(`**Resumo:** ${summary}`);

    for (const s of slice) {
      const vip      = VIP_TIERS[s.vipTier as keyof typeof VIP_TIERS];
      const expires  = new Date(s.expiresAt);
      const days     = daysLeft(expires);
      const urgency  = days <= 3 ? "🔴" : days <= 7 ? "🟡" : "🟢";
      const source   = s.source === "raffle" ? " *(sorteio)*" : "";
      embed.addFields({
        name:   `${vip?.emoji ?? "⭐"} ${vip?.name ?? s.vipTier}${source}`,
        value:  `<@${s.discordUserId}>\n🎮 \`${s.steamId}\`\n${urgency} Expira: **${ptBR(expires)}** (${days}d)`,
        inline: true,
      });
    }

    embeds.push(embed);
  }

  await interaction.editReply({ embeds });
}

import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { and, eq, gt, asc } from "drizzle-orm";
import { db, vipSubscriptionsTable } from "@workspace/db";
import { VIP_TIERS } from "../vip.js";
import { logger } from "../../lib/logger.js";

export const data = new SlashCommandBuilder()
  .setName("listvips")
  .setDescription("Lista todos os jogadores com VIP ativo e data de expiração.")
  .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers);

function discordLabel(discordUserId: string): string {
  const id = String(discordUserId || "").trim();
  return /^\d{16,22}$/.test(id) ? `<@${id}>` : "Sem Discord vinculado";
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  try {
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

    const tierCount: Record<string, number> = {};
    for (const s of active) tierCount[s.vipTier] = (tierCount[s.vipTier] ?? 0) + 1;

    const summary = Object.entries(tierCount)
      .map(([t, n]) => `${VIP_TIERS[t as keyof typeof VIP_TIERS]?.emoji ?? "⭐"} ${n}× ${VIP_TIERS[t as keyof typeof VIP_TIERS]?.name ?? t}`)
      .join("  •  ");

    // Discord aceita no máximo 6000 caracteres somando todos os embeds de UMA mensagem.
    // Por isso cada página é enviada como uma mensagem ephemeral separada.
    const CHUNK = 10;
    const embeds: EmbedBuilder[] = [];

    for (let i = 0; i < active.length; i += CHUNK) {
      const slice = active.slice(i, i + CHUNK);
      const page = Math.floor(i / CHUNK) + 1;
      const pages = Math.ceil(active.length / CHUNK);
      const embed = new EmbedBuilder()
        .setColor(0xf39c12)
        .setTitle(page === 1 ? `👑 VIPs Ativos — ${active.length} total` : `👑 VIPs Ativos — página ${page}/${pages}`)
        .setFooter({ text: `Guerra Fria • ${ptBR(now)} • Página ${page}/${pages}` });

      if (page === 1) embed.setDescription(`**Resumo:** ${summary}`);

      for (const s of slice) {
        const vip = VIP_TIERS[s.vipTier as keyof typeof VIP_TIERS];
        const expires = new Date(s.expiresAt);
        const days = daysLeft(expires);
        const urgency = days <= 3 ? "🔴" : days <= 7 ? "🟡" : "🟢";
        const source = s.source === "raffle" ? " *(sorteio)*" : "";
        embed.addFields({
          name: `${vip?.emoji ?? "⭐"} ${vip?.name ?? s.vipTier}${source}`,
          value: `${discordLabel(s.discordUserId)}\n🎮 \`${s.steamId}\`\n${urgency} Expira: **${ptBR(expires)}** (${days}d)`,
          inline: true,
        });
      }

      embeds.push(embed);
    }

    await interaction.editReply({ embeds: [embeds[0]] });
    for (let i = 1; i < embeds.length; i++) {
      await interaction.followUp({ embeds: [embeds[i]], ephemeral: true });
    }
  } catch (err) {
    logger.error({ err }, "listvips command error");
    await interaction.editReply({ content: "❌ Não consegui carregar a lista de VIPs agora. Tente novamente em alguns segundos.", embeds: [] }).catch(() => {});
  }
}

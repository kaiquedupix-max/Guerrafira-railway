import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { and, eq, gt } from "drizzle-orm";
import { db, vipSubscriptionsTable } from "@workspace/db";
import { VIP_TIERS } from "../vip.js";
import { subscriptionServer } from "../../routes/storeOrders.js";
import { GUERRA_FRIA_SERVERS } from "../../core/servers.js";

export const data = new SlashCommandBuilder()
  .setName("meuvip")
  .setDescription("Consulta informações do seu VIP ativo no servidor.");

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const now  = new Date();
  const subs = await db
    .select()
    .from(vipSubscriptionsTable)
    .where(
      and(
        eq(vipSubscriptionsTable.discordUserId, interaction.user.id),
        gt(vipSubscriptionsTable.expiresAt, now),
        eq(vipSubscriptionsTable.gameVipRemoved, false),
      ),
    );

  if (!subs.length) {
    const embed = new EmbedBuilder()
      .setColor(0x95a5a6)
      .setTitle("❌  Nenhum VIP Ativo")
      .setDescription(
        "Você não possui VIP ativo no momento.\n\n" +
        "Compre na loja oficial: https://www.guerrafriarust.com.br/loja",
      )
      .setFooter({ text: "Guerra Fria" });
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  const ptBR = (d: Date) =>
    new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "long",
      timeStyle: "short",
      timeZone: "America/Sao_Paulo",
    }).format(d);

  const embeds = await Promise.all(subs.map(async (s) => {
    const vip     = VIP_TIERS[s.vipTier as keyof typeof VIP_TIERS];
    const expires = new Date(s.expiresAt);
    const starts  = new Date(s.startsAt);
    const msLeft  = expires.getTime() - now.getTime();
    const dLeft   = Math.max(0, Math.ceil(msLeft / 86_400_000));
    const hLeft   = Math.max(0, Math.ceil((msLeft % 86_400_000) / 3_600_000));
    const urgency = dLeft <= 3 ? "🔴 Expirando em breve!" : dLeft <= 7 ? "🟡 Expira em breve" : "🟢 Ativo";
    const sourceLabel = s.source === "raffle" ? "🎉 Sorteio" : s.source.startsWith("manual:") ? "🛡️ Concessão administrativa" : "💳 Compra";

    return new EmbedBuilder()
      .setColor(vip?.color ?? 0xf39c12)
      .setTitle(`${vip?.emoji ?? "⭐"}  Seu ${vip?.name ?? s.vipTier}`)
      .setDescription(`${urgency}`)
      .addFields(
        { name: "🎮 Steam ID",      value: `\`${s.steamId}\``,   inline: true },
        { name: "📦 Plano",         value: vip?.name ?? s.vipTier, inline: true },
        { name: "Servidor", value:GUERRA_FRIA_SERVERS[await subscriptionServer(s.source)].name,inline:true },
        { name: "🎁 Origem",        value: sourceLabel,            inline: true },
        { name: "📅 Ativado em",    value: ptBR(starts),           inline: true },
        { name: "⏰ Expira em",     value: ptBR(expires),          inline: true },
        { name: "⏳ Tempo restante", value: `**${dLeft}** dias e **${hLeft}** horas`, inline: true },
        {
          name:  "✨ Benefícios",
          value: (vip?.benefits ?? []).map((b) => `• ${b}`).join("\n") || "—",
        },
      )
      .setFooter({ text: "Guerra Fria • Sistema VIP" })
      .setTimestamp();
  }));

  await interaction.editReply({ embeds:embeds.slice(0,4) });
  for(let i=4;i<embeds.length;i+=4)await interaction.followUp({embeds:embeds.slice(i,i+4),ephemeral:true});
}

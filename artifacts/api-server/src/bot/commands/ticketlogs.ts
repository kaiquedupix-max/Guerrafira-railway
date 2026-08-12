import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  StringSelectMenuBuilder,
  ActionRowBuilder,
  AttachmentBuilder,
  type ChatInputCommandInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import { desc } from "drizzle-orm";
import { db, ticketLogsTable } from "@workspace/db";
import { buildTranscriptTextFromRaw } from "../tickets.js";
import { logger } from "../../lib/logger.js";

export const data = new SlashCommandBuilder()
  .setName("ticketlogs")
  .setDescription("Lista e consulta o histórico de todos os tickets já criados.")
  .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers);

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const tickets = await db
    .select()
    .from(ticketLogsTable)
    .orderBy(desc(ticketLogsTable.closedAt))
    .limit(25);

  if (!tickets.length) {
    await interaction.editReply({ content: "📋 Nenhum ticket registrado ainda." });
    return;
  }

  const ptBR = (d: Date | null) =>
    d
      ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(d)
      : "em aberto";

  const TYPE_LABELS: Record<string, string> = {
    suporte:  "🛠️ Suporte",
    vip:      "👑 VIP",
    denuncia: "🚨 Denúncia",
    recurso:  "⚖️ Recurso",
  };

  const select = new StringSelectMenuBuilder()
    .setCustomId("ticket_log_select")
    .setPlaceholder("Selecione um ticket para ver o log…")
    .addOptions(
      tickets.map((t) => ({
        label:       (t.channelName ?? `ticket-${t.id}`).slice(0, 100),
        description: `${TYPE_LABELS[t.type ?? ""] ?? t.type ?? "?"} • Fechado: ${ptBR(t.closedAt)}`.slice(0, 100),
        value:       String(t.id),
      })),
    );

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("📋  Histórico de Tickets")
    .setDescription(`Exibindo os **${tickets.length}** tickets mais recentes.\nSelecione um para baixar o log completo.`)
    .setFooter({ text: "Guerra Fria • Ticket Logs" });

  await interaction.editReply({
    embeds:     [embed],
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
  });
}

/** Chamado de bot/index.ts quando o usuário seleciona um ticket */
export async function handleTicketLogSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  await interaction.deferUpdate();

  const id     = parseInt(interaction.values[0]!, 10);
  const ticket = await db
    .select()
    .from(ticketLogsTable)
    .then((rows) => rows.find((r) => r.id === id));

  if (!ticket) {
    await interaction.editReply({ content: "❌ Ticket não encontrado.", components: [] });
    return;
  }

  const ptBR = (d: Date | null) =>
    d
      ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "long", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(d)
      : "—";

  const msgs     = ticket.transcript ? (JSON.parse(ticket.transcript) as import("../tickets.js").TranscriptMsg[]) : [];
  const text     = buildTranscriptTextFromRaw(ticket.channelName ?? "ticket", ticket.closedAt, msgs);
  const buffer   = Buffer.from(text, "utf-8");
  const fileName = `${ticket.channelName ?? `ticket-${ticket.id}`}.txt`;

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`📋  ${ticket.channelName ?? `Ticket #${ticket.id}`}`)
    .addFields(
      { name: "📋 Tipo",        value: ticket.type ?? "—",                          inline: true },
      { name: "👤 Aberto por", value: ticket.openedByDiscordId ? `<@${ticket.openedByDiscordId}>` : "—", inline: true },
      { name: "🔒 Fechado por", value: ticket.closedByUsername ?? "—",              inline: true },
      { name: "📅 Aberto em",  value: ptBR(ticket.openedAt),                        inline: true },
      { name: "📅 Fechado em", value: ptBR(ticket.closedAt),                        inline: true },
      { name: "💬 Mensagens",  value: String(msgs.length),                          inline: true },
    )
    .setFooter({ text: "Guerra Fria • Ticket Logs" });

  await interaction.editReply({
    embeds:     [embed],
    components: [],
    files:      [new AttachmentBuilder(buffer, { name: fileName })],
  });

  logger.info({ ticketId: id, requestedBy: interaction.user.tag }, "Ticket log retrieved");
}

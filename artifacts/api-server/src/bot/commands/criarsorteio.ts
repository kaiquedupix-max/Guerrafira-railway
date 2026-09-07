import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  type ChatInputCommandInteraction,
} from "discord.js";
import { createRaffleCampaign } from "../raffle.js";

export const data = new SlashCommandBuilder()
  .setName("sorteio")
  .setDescription("Cria um sorteio para todos ou exclusivo para VIP")
  .addStringOption((opt) =>
    opt
      .setName("premio")
      .setDescription("Descreva exatamente o prêmio do sorteio")
      .setRequired(true)
      .setMinLength(2)
      .setMaxLength(300),
  )
  .addStringOption((opt) =>
    opt
      .setName("tempo")
      .setDescription("Quanto tempo o sorteio ficará aberto")
      .setRequired(true)
      .addChoices(
        { name: "30 minutos", value: "0.5" },
        { name: "1 hora", value: "1" },
        { name: "3 horas", value: "3" },
        { name: "6 horas", value: "6" },
        { name: "12 horas", value: "12" },
        { name: "24 horas", value: "24" },
        { name: "2 dias", value: "48" },
        { name: "3 dias", value: "72" },
        { name: "7 dias", value: "168" },
      ),
  )
  .addIntegerOption((opt) =>
    opt
      .setName("vencedores")
      .setDescription("Quantidade de vencedores")
      .setRequired(true)
      .addChoices(
        { name: "1 vencedor", value: 1 },
        { name: "2 vencedores", value: 2 },
      ),
  )
  .addStringOption((opt) =>
    opt
      .setName("publico")
      .setDescription("Quem pode participar")
      .setRequired(true)
      .addChoices(
        { name: "Todos os membros", value: "todos" },
        { name: "Somente VIP", value: "vip" },
      ),
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const prize = interaction.options.getString("premio", true).trim();
  const raffleHours = Number(interaction.options.getString("tempo", true));
  const winnerCount = interaction.options.getInteger("vencedores", true);
  const audience = interaction.options.getString("publico", true);
  const vipOnly = audience === "vip";

  const result = await createRaffleCampaign({
    client: interaction.client,
    prize,
    raffleHours,
    winnerCount,
    vipOnly,
    createdBy: interaction.user.id,
  });

  await interaction.editReply(
    [
      "✅ Sorteio criado!",
      `🎁 **${prize}**`,
      `🏆 **${winnerCount} ${winnerCount === 1 ? "vencedor" : "vencedores"}**`,
      `👥 Público: **${vipOnly ? "Somente VIP" : "Todos os membros"}**`,
      `⏰ Encerra <t:${Math.floor(result.endsAt.getTime() / 1000)}:R>.`,
    ].join("\n"),
  );
}

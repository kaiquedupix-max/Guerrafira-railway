import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  type ChatInputCommandInteraction,
} from "discord.js";
import { createVipOnlyRaffle } from "../raffle.js";

export const data = new SlashCommandBuilder()
  .setName("sorteio-vip")
  .setDescription("Cria um sorteio exclusivo para membros VIP")
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
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const prize = interaction.options.getString("premio", true).trim();
  const raffleHours = Number(interaction.options.getString("tempo", true));

  const result = await createVipOnlyRaffle({
    client: interaction.client,
    prize,
    raffleHours,
    createdBy: interaction.user.id,
  });

  await interaction.editReply(
    `✅ Sorteio VIP criado!\n🎁 **${prize}**\n⏰ Encerra <t:${Math.floor(result.endsAt.getTime() / 1000)}:R>.\n🔒 Somente membros com o cargo VIP podem participar.`,
  );
}

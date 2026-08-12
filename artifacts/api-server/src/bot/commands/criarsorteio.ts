import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  type ChatInputCommandInteraction,
} from "discord.js";
import { createRaffle } from "../raffle.js";
import { type VipTier } from "../vip.js";

export const data = new SlashCommandBuilder()
  .setName("criarsorteio")
  .setDescription("Cria um sorteio de VIP para os jogadores do servidor")
  .addStringOption((opt) =>
    opt
      .setName("premio")
      .setDescription("Tipo de VIP a ser sorteado")
      .setRequired(true)
      .addChoices(
        { name: "🥉 VIP Bronze", value: "bronze" },
        { name: "🥈 VIP Prata",  value: "prata"  },
        { name: "🥇 VIP Ouro",   value: "ouro"   },
      ),
  )
  .addStringOption((opt) =>
    opt
      .setName("duracao_vip")
      .setDescription("Por quantos dias o vencedor terá o VIP")
      .setRequired(true)
      .addChoices(
        { name: "3 dias",  value: "3"  },
        { name: "7 dias",  value: "7"  },
        { name: "30 dias", value: "30" },
      ),
  )
  .addStringOption((opt) =>
    opt
      .setName("duracao_sorteio")
      .setDescription("Por quanto tempo o sorteio ficará aberto para participação")
      .setRequired(true)
      .addChoices(
        { name: "1 hora",   value: "1"   },
        { name: "6 horas",  value: "6"   },
        { name: "12 horas", value: "12"  },
        { name: "24 horas", value: "24"  },
        { name: "3 dias",   value: "72"  },
        { name: "7 dias",   value: "168" },
      ),
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const tier         = interaction.options.getString("premio",          true) as VipTier;
  const vipDays      = parseInt(interaction.options.getString("duracao_vip",     true), 10);
  const raffleHours  = parseInt(interaction.options.getString("duracao_sorteio", true), 10);

  await createRaffle({
    client: interaction.client,
    tier,
    vipDurationDays: vipDays,
    raffleHours,
    createdBy: interaction.user.id,
  });

  await interaction.editReply(
    `✅ Sorteio criado! Prêmio: VIP ${tier} por ${vipDays} dias. Encerra em **${raffleHours < 24 ? raffleHours + "h" : raffleHours / 24 + " dia(s)"}**.`,
  );

  // Notificação no chat do servidor Rust
  const { executeRconCommand } = await import("../utils/rcon.js");
  await executeRconCommand(
    `say [SORTEIO] Um novo sorteio de VIP ${tier.toUpperCase()} foi criado! ` +
    `Para participar, acesse agora o nosso Discord: discord.gg/guerrafria ` +
    `e navegue ate a aba Sorteios. Boa sorte a todos!`
  ).catch(() => {});
}

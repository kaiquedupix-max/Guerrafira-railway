import { EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { pool } from "@workspace/db";
import { logger } from "../../lib/logger.js";

// Só inscrições ativas contam: pendentes (aguardando aprovação) e aprovadas.
// Rejeitadas ficam fora para não inflar o número de inscritos.
const ACTIVE_STATUSES: string[] = ["pending", "approved"];

export const data = new SlashCommandBuilder()
  .setName("invaders")
  .setDescription("Base Invaders: acompanhe as inscrições e a prévia do sorteio.")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand(sub => sub.setName("inscritos").setDescription("Mostra quantas equipes e jogadores já estão inscritos."))
  .addSubcommand(sub => sub.setName("previa-sorteio").setDescription("Mostra quantos trios sairiam com os inscritos solo."));

type GroupRow = { registration_mode: string; status: string; teams: string; players: string };

export type Totals = {
  trioTeamsPending: number;
  trioTeamsApproved: number;
  trioPlayers: number;
  soloPending: number;
  soloApproved: number;
};

// Uma consulta agregada, sem trazer os jogadores para a memória do bot.
export async function loadTotals(): Promise<Totals> {
  const { rows } = await pool.query<GroupRow>(
    `SELECT registration_mode, status, COUNT(*)::text AS teams,
            COALESCE(SUM(jsonb_array_length(players)), 0)::text AS players
       FROM base_invaders_teams
      WHERE status = ANY($1)
      GROUP BY registration_mode, status`,
    [ACTIVE_STATUSES],
  );

  const totals: Totals = { trioTeamsPending: 0, trioTeamsApproved: 0, trioPlayers: 0, soloPending: 0, soloApproved: 0 };
  for (const row of rows) {
    const teams = Number(row.teams);
    const players = Number(row.players);
    if (row.registration_mode === "random") {
      // Cada inscrição solo traz exatamente um jogador.
      if (row.status === "pending") totals.soloPending += players;
      else totals.soloApproved += players;
    } else {
      if (row.status === "pending") totals.trioTeamsPending += teams;
      else totals.trioTeamsApproved += teams;
      totals.trioPlayers += players;
    }
  }
  return totals;
}

export function buildInscritosEmbed(t: Totals): EmbedBuilder {
  const trioTeams = t.trioTeamsPending + t.trioTeamsApproved;
  const solo = t.soloPending + t.soloApproved;
  return new EmbedBuilder()
    .setColor(0xffb800)
    .setTitle("Base Invaders • Inscrições")
    .addFields(
      { name: "Equipes em trio", value: `**${trioTeams}** (${t.trioTeamsApproved} aprovadas, ${t.trioTeamsPending} pendentes)`, inline: false },
      { name: "Jogadores em trio", value: `**${t.trioPlayers}**`, inline: true },
      { name: "Inscritos solo", value: `**${solo}** (${t.soloApproved} aprovados, ${t.soloPending} pendentes)`, inline: true },
      { name: "Total de jogadores", value: `**${t.trioPlayers + solo}**`, inline: false },
    )
    .setFooter({ text: "Inscrições rejeitadas não entram na contagem." });
}

export function buildPreviaEmbed(t: Totals): EmbedBuilder {
  const solo = t.soloPending + t.soloApproved;
  const trios = Math.floor(solo / 3);
  const sobra = solo % 3;
  const sobraTexto = sobra === 0
    ? "Nenhum solo ficará de fora."
    : `${sobra} solo(s) ficariam de fora. Use o preenchimento de times incompletos antes de sortear.`;
  return new EmbedBuilder()
    .setColor(0xffb800)
    .setTitle("Base Invaders • Prévia do sorteio")
    .setDescription(`Com **${solo}** inscritos solo, o sorteio formaria **${trios}** trio(s) de 3 jogadores.`)
    .addFields({ name: "Sobras", value: sobraTexto })
    .setFooter({ text: "Prévia apenas informativa. O sorteio real é feito pela administração no dia do evento." });
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const sub = interaction.options.getSubcommand();
  await interaction.deferReply({ ephemeral: true });
  try {
    const totals = await loadTotals();
    const embed = sub === "previa-sorteio" ? buildPreviaEmbed(totals) : buildInscritosEmbed(totals);
    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    logger.error({ error, subcommand: sub }, "Falha ao consultar inscrições do Base Invaders pelo bot");
    await interaction.editReply("Não consegui consultar as inscrições agora. Tente de novo em instantes.");
  }
}

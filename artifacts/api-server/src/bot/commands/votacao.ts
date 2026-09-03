import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { pool } from "@workspace/db";
import { forceFinishActiveMapVote } from "./criarmapa.js";

const VIP_ROLE_ID = "1499084540356853917";
const BOOSTER_ROLE_ID = "1536607642364018688";

type MapOption = {
  name?: string;
  mode?: "seed" | "link";
  seed?: number;
  size?: number;
  mapUrl?: string;
};

type ActiveVoteRow = {
  id: number;
  message_id: string;
  channel_id: string;
  maps_json: string;
  ends_at: Date | string;
  wipe_at: Date | string | null;
};

type VoteCountRow = {
  option_index: number;
  voters: number | string;
  votes: number | string;
};

export const data = new SlashCommandBuilder()
  .setName("votacao")
  .setDescription("Mostra o placar ou controla a votação de mapa atual")
  .addStringOption(option => option
    .setName("acao")
    .setDescription("Ação desejada")
    .setRequired(false)
    .addChoices(
      { name: "📊 Ver placar", value: "placar" },
      { name: "🛑 Forçar fim da votação (ADM)", value: "forcar_fim" },
    ));

function hasRole(interaction: ChatInputCommandInteraction, roleId: string): boolean {
  const member = interaction.member;
  if (!member) return false;
  if (Array.isArray(member.roles)) return member.roles.includes(roleId);
  return member.roles.cache.has(roleId);
}

function mapTechnicalDetails(map: MapOption): string {
  if (map.mode === "link" || map.mapUrl) return "Mapa customizado (.map)";
  const details: string[] = [];
  if (Number.isFinite(Number(map.seed))) details.push(`Seed ${Number(map.seed)}`);
  if (Number.isFinite(Number(map.size))) details.push(`Size ${Number(map.size)}`);
  return details.length ? details.join(" • ") : "Mapa procedural";
}

function discordTimestamp(value: Date | string | null, style: "F" | "R"): string {
  if (!value) return "Não informado";
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return "Não informado";
  return `<t:${Math.floor(time / 1000)}:${style}>`;
}

async function handleForcedFinish(interaction: ChatInputCommandInteraction): Promise<void> {
  const activeVote = await pool.query<ActiveVoteRow>(
    `SELECT id, message_id, channel_id, maps_json, ends_at, wipe_at
       FROM map_votes
      WHERE status = 'active'
      ORDER BY created_at DESC
      LIMIT 1`,
  );
  const vote = activeVote.rows[0];
  if (!vote) {
    await interaction.editReply("ℹ️ Não há nenhuma votação de mapa ativa para encerrar.");
    return;
  }

  let maps: MapOption[] = [];
  try { maps = JSON.parse(vote.maps_json); } catch {}
  const aggregate = await pool.query<VoteCountRow>(
    `SELECT option_index, COUNT(*)::int AS voters, COALESCE(SUM(weight),0)::int AS votes
       FROM map_vote_ballots WHERE map_vote_id=$1 GROUP BY option_index`,
    [vote.id],
  );
  const counts = maps.map(() => 0);
  for (const row of aggregate.rows) {
    const idx = Number(row.option_index);
    if (counts[idx] !== undefined) counts[idx] = Number(row.votes) || 0;
  }
  const currentMax = counts.length ? Math.max(...counts) : 0;
  const currentLeaders = counts
    .map((value, index) => ({ value, index }))
    .filter(x => x.value === currentMax)
    .map(x => maps[x.index]?.name || `Mapa ${x.index + 1}`);
  const currentResult = currentMax > 0
    ? `Liderança atual: **${currentLeaders.join(" / ")}** com **${currentMax} voto(s)**.`
    : "Ainda não há votos; se encerrar agora, o Mapa 1 será selecionado automaticamente.";

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("vote_force_wipe").setLabel("Encerrar + wipe agora").setEmoji("🚨").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("vote_force_only").setLabel("Só encerrar votação").setEmoji("🛑").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("vote_force_cancel").setLabel("Cancelar").setStyle(ButtonStyle.Secondary),
  );

  const confirmation = new EmbedBuilder()
    .setColor(0xf59e0b)
    .setTitle("⚠️ FORÇAR FIM DA VOTAÇÃO")
    .setDescription(
      `${currentResult}\n\n` +
      "Escolha o que fazer com o **resultado atual**:\n\n" +
      "🚨 **Encerrar + wipe agora:** fecha a votação, define o vencedor atual e inicia o wipe imediatamente usando esse mapa.\n" +
      "🛑 **Só encerrar votação:** fecha a votação e define o vencedor, mas mantém o wipe no horário que já estava programado.\n\n" +
      "A ação será registrada publicamente com o administrador responsável.",
    )
    .setFooter({ text: "A confirmação expira em 60 segundos" });

  const message = await interaction.editReply({ embeds: [confirmation], components: [row] });

  try {
    const button = await message.awaitMessageComponent({
      componentType: ComponentType.Button,
      time: 60_000,
      filter: i => i.user.id === interaction.user.id && ["vote_force_wipe", "vote_force_only", "vote_force_cancel"].includes(i.customId),
    });
    await button.deferUpdate();

    if (button.customId === "vote_force_cancel") {
      await interaction.editReply({ content: "✅ Operação cancelada. A votação continua normalmente.", embeds: [], components: [] });
      return;
    }

    const wipeNow = button.customId === "vote_force_wipe";
    await interaction.editReply({
      content: wipeNow ? "⏳ Encerrando votação e iniciando o wipe..." : "⏳ Encerrando a votação...",
      embeds: [], components: [],
    });

    const result = await forceFinishActiveMapVote(
      interaction.client,
      { id: interaction.user.id, name: interaction.user.globalName ?? interaction.user.username },
      wipeNow,
    );

    await interaction.editReply({
      content:
        `✅ **Votação encerrada pelo administrador.**\n` +
        `🛡️ Administrador: <@${interaction.user.id}>\n` +
        `🏆 Mapa vencedor: **${result.winnerName}**\n` +
        (wipeNow
          ? "🚨 O resultado foi aplicado e o **wipe foi iniciado imediatamente**."
          : `🧊 O resultado foi aplicado e o wipe continua programado para <t:${Math.floor(result.wipeAt / 1000)}:F>.`),
      allowedMentions: { parse: [] },
      components: [],
    });
  } catch (error: any) {
    if (error?.code === "InteractionCollectorError") {
      await interaction.editReply({ content: "⏱️ A confirmação expirou. Nada foi alterado e a votação continua normalmente.", embeds: [], components: [] }).catch(() => {});
      return;
    }
    console.error("[votacao] Falha ao forçar fim da votação:", error);
    await interaction.editReply({
      content: `❌ ${error instanceof Error ? error.message : "Não foi possível encerrar a votação."}`,
      embeds: [], components: [],
    }).catch(() => {});
  }
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.inGuild()) {
    await interaction.reply({ content: "❌ Este comando só pode ser usado no servidor.", ephemeral: true });
    return;
  }

  const action = interaction.options.getString("acao") ?? "placar";
  const isVip = hasRole(interaction, VIP_ROLE_ID);
  const isBooster = hasRole(interaction, BOOSTER_ROLE_ID);
  const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false;

  if (action === "forcar_fim" && !isAdmin) {
    await interaction.reply({ content: "🔒 Apenas administradores podem forçar o fim da votação.", ephemeral: true });
    return;
  }

  if (!isVip && !isBooster && !isAdmin) {
    await interaction.reply({
      content: "🔒 Este comando é exclusivo para membros **VIP** e **Booster**.",
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  if (action === "forcar_fim") {
    await handleForcedFinish(interaction);
    return;
  }

  try {
    const activeVote = await pool.query<ActiveVoteRow>(
      `SELECT id, message_id, channel_id, maps_json, ends_at, wipe_at
         FROM map_votes
        WHERE status = 'active'
        ORDER BY created_at DESC
        LIMIT 1`,
    );

    const vote = activeVote.rows[0];
    if (!vote) {
      await interaction.editReply("ℹ️ Não há nenhuma votação de mapa ativa no momento.");
      return;
    }

    let maps: MapOption[];
    try {
      const parsed = JSON.parse(vote.maps_json);
      if (!Array.isArray(parsed) || parsed.length === 0) throw new Error("maps_json inválido");
      maps = parsed;
    } catch {
      await interaction.editReply("❌ A votação atual foi encontrada, mas os dados dos mapas estão inválidos.");
      return;
    }

    const aggregate = await pool.query<VoteCountRow>(
      `SELECT option_index,
              COUNT(*)::int AS voters,
              COALESCE(SUM(weight), 0)::int AS votes
         FROM map_vote_ballots
        WHERE map_vote_id = $1
        GROUP BY option_index`,
      [vote.id],
    );

    const stats = maps.map((map, index) => ({ index, map, voters: 0, votes: 0 }));
    for (const row of aggregate.rows) {
      const index = Number(row.option_index);
      if (!stats[index]) continue;
      stats[index].voters = Number(row.voters) || 0;
      stats[index].votes = Number(row.votes) || 0;
    }

    const totalVoters = stats.reduce((sum, item) => sum + item.voters, 0);
    const totalVotes = stats.reduce((sum, item) => sum + item.votes, 0);
    const maxVotes = stats.length ? Math.max(...stats.map(item => item.votes)) : 0;
    const leaders = maxVotes > 0 ? stats.filter(item => item.votes === maxVotes) : [];
    const sorted = [...stats].sort((a, b) => b.votes - a.votes || a.index - b.index);

    let headline: string;
    if (leaders.length === 0) headline = "🕐 **Ainda não há votos registrados nesta votação.**";
    else if (leaders.length === 1) {
      const leader = leaders[0];
      const percent = totalVotes > 0 ? Math.round((leader.votes / totalVotes) * 100) : 0;
      const runnerUpVotes = sorted[1]?.votes ?? 0;
      const advantage = Math.max(0, leader.votes - runnerUpVotes);
      headline = `🏆 **${leader.map.name || `Mapa ${leader.index + 1}`}** está vencendo com **${leader.votes} votos** (${percent}%).` +
        (stats.length > 1 ? `\n📈 Vantagem atual: **${advantage} voto${advantage === 1 ? "" : "s"}**.` : "");
    } else {
      headline = `🤝 **Empate na liderança** entre ${leaders.map(item => `**${item.map.name || `Mapa ${item.index + 1}`}**`).join(" e ")} com **${maxVotes} votos** cada.`;
    }

    const medals = ["🥇", "🥈", "🥉"];
    const scoreboard = sorted.map((item, position) => {
      const name = item.map.name || `Mapa ${item.index + 1}`;
      const percent = totalVotes > 0 ? Math.round((item.votes / totalVotes) * 100) : 0;
      return `${medals[position] ?? "🗺️"} **${name}** — **${item.votes} votos** • ${item.voters} pessoa${item.voters === 1 ? "" : "s"} • ${percent}%\n└ ${mapTechnicalDetails(item.map)}`;
    }).join("\n\n");

    const voteUrl = interaction.guildId
      ? `https://discord.com/channels/${interaction.guildId}/${vote.channel_id}/${vote.message_id}`
      : null;

    const embed = new EmbedBuilder()
      .setColor(0xe53935)
      .setTitle("🗳️ GUERRA FRIA — VOTAÇÃO ATUAL")
      .setDescription(`${headline}\n\n${scoreboard}`)
      .addFields(
        { name: "👥 Participação", value: `**${totalVoters}** pessoa${totalVoters === 1 ? "" : "s"} votaram\n**${totalVotes}** votos ponderados`, inline: true },
        { name: "⏳ Encerramento", value: `${discordTimestamp(vote.ends_at, "F")}\n${discordTimestamp(vote.ends_at, "R")}`, inline: true },
        { name: "🧊 Wipe previsto", value: vote.wipe_at ? `${discordTimestamp(vote.wipe_at, "F")}\n${discordTimestamp(vote.wipe_at, "R")}` : "Ainda não informado", inline: true },
        { name: "⭐ Peso dos votos", value: "VIP e Booster valem **2 votos**. Se a pessoa possuir os dois benefícios, o peso continua sendo **2**.", inline: false },
        { name: "📍 Votação oficial", value: voteUrl ? `[Abrir a votação em <#${vote.channel_id}>](${voteUrl})` : `<#${vote.channel_id}>`, inline: false },
      )
      .setFooter({ text: "Guerra Fria • Placar consultado em tempo real" })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error("[votacao] Falha ao consultar votação atual:", error);
    await interaction.editReply("❌ Não foi possível consultar o placar da votação agora.");
  }
}

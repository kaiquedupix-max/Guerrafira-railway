import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type TextChannel,
} from "discord.js";

interface MapOption { name: string; image: string; url: string; }
interface MapVote {
  messageId: string;
  channelId: string;
  endsAt: number;
  maps: MapOption[];
  votes: Map<string, number>;
  timer: ReturnType<typeof setTimeout>;
}

const activeVotes = new Map<string, MapVote>();

export const data = new SlashCommandBuilder()
  .setName("criarmapa")
  .setDescription("Cria uma votação de mapa exclusiva para os VIPs")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addStringOption(o => o.setName("mapa1").setDescription("Nome do mapa 1").setRequired(true))
  .addStringOption(o => o.setName("foto1").setDescription("URL direta da imagem do mapa 1").setRequired(true))
  .addStringOption(o => o.setName("link1").setDescription("Link do mapa 1").setRequired(true))
  .addStringOption(o => o.setName("mapa2").setDescription("Nome do mapa 2").setRequired(true))
  .addStringOption(o => o.setName("foto2").setDescription("URL direta da imagem do mapa 2").setRequired(true))
  .addStringOption(o => o.setName("link2").setDescription("Link do mapa 2").setRequired(true))
  .addStringOption(o => o.setName("mapa3").setDescription("Nome do mapa 3").setRequired(true))
  .addStringOption(o => o.setName("foto3").setDescription("URL direta da imagem do mapa 3").setRequired(true))
  .addStringOption(o => o.setName("link3").setDescription("Link do mapa 3").setRequired(true))
  .addStringOption(o => o.setName("duracao").setDescription("Tempo da votação").setRequired(true).addChoices(
    { name: "30 minutos", value: "30" }, { name: "1 hora", value: "60" },
    { name: "3 horas", value: "180" }, { name: "6 horas", value: "360" },
    { name: "12 horas", value: "720" }, { name: "24 horas", value: "1440" },
    { name: "2 dias", value: "2880" }, { name: "3 dias", value: "4320" },
  ));

function voteEmbed(maps: MapOption[], endsAt: number) {
  return new EmbedBuilder().setColor(0x5865f2).setTitle("🗺️ VOTAÇÃO DE MAPA — VIPS")
    .setDescription("Os membros VIP podem escolher qual mapa desejam para o próximo wipe.\n\nClique em um dos botões abaixo para registrar ou alterar seu voto.")
    .addFields(...maps.map((m, i) => ({ name: `${i + 1}️⃣ ${m.name}`, value: `[🔗 Ver mapa](${m.url})\n[🖼️ Ver imagem](${m.image})`, inline: false })),
      { name: "⏳ Encerramento", value: `<t:${Math.floor(endsAt / 1000)}:R>` })
    .setFooter({ text: "Guerra Fria • Votação exclusiva VIP" }).setTimestamp();
}

function rows(maps: MapOption[]) {
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(...maps.map((m, i) =>
    new ButtonBuilder().setCustomId(`mapvote:${i}`).setLabel(`${i + 1} • ${m.name}`.slice(0, 80)).setStyle(i === 0 ? ButtonStyle.Secondary : i === 1 ? ButtonStyle.Primary : ButtonStyle.Success)
  ))];
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });
  const channelId = process.env.DISCORD_VIP_MAP_CHANNEL_ID?.trim();
  if (!channelId) { await interaction.editReply("❌ Configure `DISCORD_VIP_MAP_CHANNEL_ID` com o ID da sala VIP."); return; }
  const channel = await interaction.client.channels.fetch(channelId).catch(() => null) as TextChannel | null;
  if (!channel?.isSendable()) { await interaction.editReply("❌ Não consegui acessar/enviar mensagens na sala VIP configurada."); return; }

  const maps: MapOption[] = [1,2,3].map(n => ({
    name: interaction.options.getString(`mapa${n}`, true),
    image: interaction.options.getString(`foto${n}`, true),
    url: interaction.options.getString(`link${n}`, true),
  }));
  const minutes = parseInt(interaction.options.getString("duracao", true), 10);
  const endsAt = Date.now() + minutes * 60_000;
  const message = await channel.send({ embeds: [voteEmbed(maps, endsAt)], components: rows(maps) });
  const timer = setTimeout(() => finishVote(interaction.client, message.id).catch(() => {}), minutes * 60_000);
  activeVotes.set(message.id, { messageId: message.id, channelId, endsAt, maps, votes: new Map(), timer });
  await interaction.editReply(`✅ Votação criada em <#${channelId}> e encerrará <t:${Math.floor(endsAt/1000)}:R>.`);
}

export async function handleMapVote(interaction: ButtonInteraction): Promise<void> {
  const vote = activeVotes.get(interaction.message.id);
  if (!vote) { await interaction.reply({ content: "❌ Esta votação já foi encerrada ou não está mais ativa.", ephemeral: true }); return; }
  const vipRoleIds = [process.env.VIP_BRONZE_ROLE_ID, process.env.VIP_PRATA_ROLE_ID, process.env.VIP_OURO_ROLE_ID].filter(Boolean) as string[];
  const memberRoles = interaction.member && "roles" in interaction.member ? interaction.member.roles : [];
  const roleIds = Array.isArray(memberRoles) ? memberRoles : [];
  if (vipRoleIds.length && !vipRoleIds.some(id => roleIds.includes(id))) {
    await interaction.reply({ content: "❌ Esta votação é exclusiva para membros VIP.", ephemeral: true }); return;
  }
  const option = Number(interaction.customId.split(":")[1]);
  if (!Number.isInteger(option) || !vote.maps[option]) return;
  vote.votes.set(interaction.user.id, option);
  await interaction.reply({ content: `✅ Seu voto foi registrado em **${vote.maps[option].name}**. Você pode alterar o voto até o encerramento.`, ephemeral: true });
}

async function finishVote(client: Client, messageId: string): Promise<void> {
  const vote = activeVotes.get(messageId); if (!vote) return;
  clearTimeout(vote.timer); activeVotes.delete(messageId);
  const counts = [0,0,0]; for (const option of vote.votes.values()) counts[option]++;
  const max = Math.max(...counts); const winners = counts.map((v,i) => v === max ? i : -1).filter(i => i >= 0);
  const channel = await client.channels.fetch(vote.channelId).catch(() => null) as TextChannel | null;
  if (!channel?.isSendable()) return;
  const msg = await channel.messages.fetch(messageId).catch(() => null); if (msg) await msg.edit({ components: [] }).catch(() => {});
  const result = vote.votes.size === 0 ? "Nenhum voto foi registrado." : winners.length === 1 ? `🏆 **${vote.maps[winners[0]].name}** venceu a votação!` : `🤝 Empate entre: **${winners.map(i => vote.maps[i].name).join(" • ")}**.`;
  const embed = new EmbedBuilder().setColor(0xf1c40f).setTitle("🏁 RESULTADO — VOTAÇÃO DE MAPA").setDescription(result)
    .addFields(...vote.maps.map((m,i) => ({ name: `${i+1}️⃣ ${m.name}`, value: `**${counts[i]} voto(s)**`, inline: true })))
    .setFooter({ text: "Guerra Fria • Votação VIP encerrada" }).setTimestamp();
  await channel.send({ embeds: [embed] });
}

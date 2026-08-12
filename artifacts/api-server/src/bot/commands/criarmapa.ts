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
import { executeRconCommand } from "../utils/rcon.js";

interface MapOption { name: string; image: string; url: string; }
interface MapVote {
  messageId: string;
  channelId: string;
  endsAt: number;
  maps: MapOption[];
  votes: Map<string, number>;
  timer: ReturnType<typeof setTimeout>;
  announcementTimer: ReturnType<typeof setInterval>;
}

const activeVotes = new Map<string, MapVote>();
const VOTE_CHANNEL_ID = "1537001939504734238";
const CHAT_CHANNEL_ID = "1499084541791436861";
const ANNOUNCEMENT_INTERVAL = 4 * 60 * 60_000;

export const data = new SlashCommandBuilder()
  .setName("criarmapa")
  .setDescription("Cria uma votação de mapa para a comunidade")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addAttachmentOption(o => o.setName("imagem1").setDescription("Imagem do Mapa 1").setRequired(true))
  .addStringOption(o => o.setName("link1").setDescription("Link do Mapa 1").setRequired(true))
  .addAttachmentOption(o => o.setName("imagem2").setDescription("Imagem do Mapa 2").setRequired(true))
  .addStringOption(o => o.setName("link2").setDescription("Link do Mapa 2").setRequired(true))
  .addAttachmentOption(o => o.setName("imagem3").setDescription("Imagem do Mapa 3").setRequired(true))
  .addStringOption(o => o.setName("link3").setDescription("Link do Mapa 3").setRequired(true))
  .addStringOption(o => o.setName("duracao").setDescription("Tempo da votação").setRequired(true).addChoices(
    { name: "30 minutos", value: "30" }, { name: "1 hora", value: "60" },
    { name: "3 horas", value: "180" }, { name: "6 horas", value: "360" },
    { name: "12 horas", value: "720" }, { name: "24 horas", value: "1440" },
    { name: "2 dias", value: "2880" }, { name: "3 dias", value: "4320" },
  ));

function headerEmbed(endsAt: number) {
  return new EmbedBuilder().setColor(0x5865f2).setTitle("🗺️ VOTAÇÃO DE MAPA — GUERRA FRIA")
    .setDescription("Escolha qual mapa deseja para o próximo wipe.\n\n🌎 **A votação está liberada para toda a comunidade.**\n\nAs opções são identificadas automaticamente como **Mapa 1, Mapa 2 e Mapa 3**. Clique no botão correspondente para registrar ou alterar seu voto.")
    .addFields({ name: "⏳ Encerramento", value: `<t:${Math.floor(endsAt / 1000)}:R>` })
    .setFooter({ text: "Guerra Fria • Votação da Comunidade" }).setTimestamp();
}

function mapEmbeds(maps: MapOption[]) {
  return maps.map((m, i) => new EmbedBuilder().setColor(i === 0 ? 0x95a5a6 : i === 1 ? 0x3498db : 0xf1c40f).setTitle(`${i + 1}️⃣ ${m.name}`).setDescription(`[🔗 Abrir página do mapa](${m.url})`).setImage(m.image));
}

function rows(maps: MapOption[]) {
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(...maps.map((m, i) => new ButtonBuilder().setCustomId(`mapvote:${i}`).setLabel(`Votar no ${m.name}`).setStyle(i === 0 ? ButtonStyle.Secondary : i === 1 ? ButtonStyle.Primary : ButtonStyle.Success)))];
}

async function announceVote(client: Client, endsAt: number): Promise<void> {
  if (Date.now() >= endsAt) return;
  const chat = await client.channels.fetch(CHAT_CHANNEL_ID).catch(() => null) as TextChannel | null;
  if (chat?.isSendable()) {
    await chat.send(`🗳️ **VOTAÇÃO DE MAPA ABERTA!**\n\nA votação para escolher o mapa do próximo wipe está rolando! 🔥\nAcesse <#${VOTE_CHANNEL_ID}>, confira as opções e registre seu voto.\n\n⏳ A votação encerra <t:${Math.floor(endsAt / 1000)}:R>.\n🇧🇷 **Sua escolha ajuda a decidir o próximo mapa do Guerra Fria!**`).catch(() => {});
  }
  await executeRconCommand("say <color=#ff3b3b>[GUERRA FRIA]</color> <color=#7CFC00>Entre no Discord: discord.gg/guerrafria e vote no mapa do próximo wipe!</color>").catch(() => null);
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });
  const channelId = process.env.DISCORD_VIP_MAP_CHANNEL_ID?.trim() || VOTE_CHANNEL_ID;
  const channel = await interaction.client.channels.fetch(channelId).catch(() => null) as TextChannel | null;
  if (!channel?.isSendable()) { await interaction.editReply("❌ Não consegui acessar ou enviar mensagens na sala de votação configurada."); return; }

  const maps: MapOption[] = [1, 2, 3].map((n) => {
    const attachment = interaction.options.getAttachment(`imagem${n}`, true);
    if (!attachment.contentType?.startsWith("image/")) throw new Error(`O arquivo enviado em imagem${n} não é uma imagem válida.`);
    return { name: `Mapa ${n}`, image: attachment.url, url: interaction.options.getString(`link${n}`, true) };
  });
  const minutes = parseInt(interaction.options.getString("duracao", true), 10);
  const endsAt = Date.now() + minutes * 60_000;
  const message = await channel.send({ embeds: [headerEmbed(endsAt), ...mapEmbeds(maps)], components: rows(maps) });

  await announceVote(interaction.client, endsAt);
  const announcementTimer = setInterval(() => announceVote(interaction.client, endsAt).catch(() => {}), ANNOUNCEMENT_INTERVAL);
  const timer = setTimeout(() => finishVote(interaction.client, message.id).catch(() => {}), minutes * 60_000);
  activeVotes.set(message.id, { messageId: message.id, channelId, endsAt, maps, votes: new Map(), timer, announcementTimer });
  await interaction.editReply(`✅ Votação criada em <#${channelId}> e encerrará <t:${Math.floor(endsAt / 1000)}:R>. Os avisos serão enviados no Discord e no jogo a cada 4 horas enquanto ela estiver ativa.`);
}

export async function handleMapVote(interaction: ButtonInteraction): Promise<void> {
  const vote = activeVotes.get(interaction.message.id);
  if (!vote) { await interaction.reply({ content: "❌ Esta votação já foi encerrada ou não está mais ativa.", ephemeral: true }); return; }
  const option = Number(interaction.customId.split(":")[1]);
  if (!Number.isInteger(option) || !vote.maps[option]) return;
  vote.votes.set(interaction.user.id, option);
  await interaction.reply({ content: `✅ Seu voto foi registrado em **${vote.maps[option].name}**. Você pode alterar o voto até o encerramento.`, ephemeral: true });
}

async function finishVote(client: Client, messageId: string): Promise<void> {
  const vote = activeVotes.get(messageId); if (!vote) return;
  clearTimeout(vote.timer); clearInterval(vote.announcementTimer); activeVotes.delete(messageId);
  const counts = [0, 0, 0]; for (const option of vote.votes.values()) counts[option]++;
  const max = Math.max(...counts); const winners = counts.map((v, i) => v === max ? i : -1).filter(i => i >= 0);
  const channel = await client.channels.fetch(vote.channelId).catch(() => null) as TextChannel | null; if (!channel?.isSendable()) return;
  const msg = await channel.messages.fetch(messageId).catch(() => null); if (msg) await msg.edit({ components: [] }).catch(() => {});
  const result = vote.votes.size === 0 ? "Nenhum voto foi registrado." : winners.length === 1 ? `🏆 **${vote.maps[winners[0]].name}** venceu a votação!` : `🤝 Empate entre: **${winners.map(i => vote.maps[i].name).join(" • ")}**.`;
  const embed = new EmbedBuilder().setColor(0xf1c40f).setTitle("🏁 RESULTADO — VOTAÇÃO DE MAPA").setDescription(result).addFields(...vote.maps.map((m, i) => ({ name: `${i + 1}️⃣ ${m.name}`, value: `**${counts[i]} voto(s)**`, inline: true }))).setFooter({ text: "Guerra Fria • Votação da Comunidade encerrada" }).setTimestamp();
  await channel.send({ embeds: [embed] });
}

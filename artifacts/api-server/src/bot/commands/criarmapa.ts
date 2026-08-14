import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionFlagsBits,
  SlashCommandBuilder, type ButtonInteraction, type ChatInputCommandInteraction,
  type Client, type TextChannel,
} from "discord.js";
import { and, eq, gt } from "drizzle-orm";
import { db, mapVotesTable, mapVoteBallotsTable, vipSubscriptionsTable, boosterLinksTable } from "@workspace/db";
import { executeRconCommand } from "../utils/rcon.js";

interface MapOption { name: string; image: string; }
interface MapVoteRuntime {
  id: number; messageId: string; channelId: string; endsAt: number; maps: MapOption[];
  timer?: ReturnType<typeof setTimeout>; announcementTimer?: ReturnType<typeof setInterval>;
}

const activeVotes = new Map<string, MapVoteRuntime>();
const VOTE_CHANNEL_ID = "1537001939504734238";
const CHAT_CHANNEL_ID = "1499084541791436861";
const ANNOUNCEMENT_INTERVAL = 4 * 60 * 60_000;

export const data = new SlashCommandBuilder()
  .setName("criarmapa").setDescription("Cria uma votação de mapa para a comunidade")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addAttachmentOption(o => o.setName("imagem1").setDescription("Imagem do Mapa 1").setRequired(true))
  .addAttachmentOption(o => o.setName("imagem2").setDescription("Imagem do Mapa 2").setRequired(true))
  .addAttachmentOption(o => o.setName("imagem3").setDescription("Imagem do Mapa 3").setRequired(true))
  .addStringOption(o => o.setName("duracao").setDescription("Tempo da votação").setRequired(true).addChoices(
    { name: "30 minutos", value: "30" }, { name: "1 hora", value: "60" }, { name: "3 horas", value: "180" },
    { name: "6 horas", value: "360" }, { name: "12 horas", value: "720" }, { name: "24 horas", value: "1440" },
    { name: "2 dias", value: "2880" }, { name: "3 dias", value: "4320" },
  ));

function headerEmbed(endsAt: number) {
  return new EmbedBuilder().setColor(0xe53935).setTitle("🗺️ GUERRA FRIA 2X — VOTAÇÃO DE MAPA")
    .setDescription(
      "**Vote no mapa que você deseja para o próximo wipe!**\n\n" +
      "📦 **Como votar**\nClique no botão correspondente ao seu mapa favorito. Você pode trocar seu voto enquanto a votação estiver aberta.\n\n" +
      "⭐ **Bônus para cargos especiais**\nMembros com **VIP ativo** ou **Server Booster ativo** têm seu voto contado como **2 votos** em vez de 1.\n" +
      "Se possuir os dois benefícios, o peso continua sendo **2 votos**.\n\n" +
      `⏳ **Encerramento:** <t:${Math.floor(endsAt / 1000)}:R>`
    )
    .setFooter({ text: "Guerra Fria • Votação oficial da comunidade" }).setTimestamp();
}

function mapEmbeds(maps: MapOption[]) {
  const colors = [0xe53935, 0x5865f2, 0x2ecc71];
  return maps.map((m, i) => new EmbedBuilder().setColor(colors[i] ?? 0x5865f2)
    .setTitle(`🗺️ ${m.name}`).setImage(m.image));
}

function rows(maps: MapOption[]) {
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(...maps.map((m, i) =>
    new ButtonBuilder().setCustomId(`mapvote:${i}`).setLabel(m.name).setEmoji(["1️⃣", "2️⃣", "3️⃣"][i] ?? "🗺️")
      .setStyle(i === 0 ? ButtonStyle.Danger : i === 1 ? ButtonStyle.Primary : ButtonStyle.Success)
  ))];
}

async function announceVote(client: Client, endsAt: number): Promise<void> {
  if (Date.now() >= endsAt) return;
  const chat = await client.channels.fetch(CHAT_CHANNEL_ID).catch(() => null) as TextChannel | null;
  if (chat?.isSendable()) await chat.send(`🗳️ **VOTAÇÃO DE MAPA ABERTA!**\nAcesse <#${VOTE_CHANNEL_ID}> e escolha o mapa do próximo wipe.\n⭐ **VIPs e Boosters valem 2 votos.**\n⏳ Encerra <t:${Math.floor(endsAt / 1000)}:R>.`).catch(() => {});
  await executeRconCommand("say <color=#ff8c00>[GUERRA FRIA]</color> <color=#7CFC00>Vote no mapa do proximo wipe no Discord: discord.gg/guerrafria</color>").catch(() => null);
}

function scheduleRuntime(client: Client, vote: MapVoteRuntime): void {
  const old = activeVotes.get(vote.messageId);
  if (old?.timer) clearTimeout(old.timer); if (old?.announcementTimer) clearInterval(old.announcementTimer);
  const remaining = vote.endsAt - Date.now();
  if (remaining <= 0) { finishVote(client, vote.messageId).catch(() => {}); return; }
  vote.timer = setTimeout(() => finishVote(client, vote.messageId).catch(() => {}), remaining);
  vote.announcementTimer = setInterval(() => announceVote(client, vote.endsAt).catch(() => {}), ANNOUNCEMENT_INTERVAL);
  activeVotes.set(vote.messageId, vote);
}

async function loadVote(messageId: string, client?: Client): Promise<MapVoteRuntime | null> {
  const cached = activeVotes.get(messageId); if (cached) return cached;
  const rows = await db.select().from(mapVotesTable).where(and(eq(mapVotesTable.messageId, messageId), eq(mapVotesTable.status, "active"))).limit(1);
  const saved = rows[0]; if (!saved) return null;
  let maps: MapOption[]; try { maps = JSON.parse(saved.mapsJson) as MapOption[]; } catch { return null; }
  const vote: MapVoteRuntime = { id: saved.id, messageId: saved.messageId, channelId: saved.channelId, endsAt: saved.endsAt.getTime(), maps };
  if (client) scheduleRuntime(client, vote); return vote;
}

async function getVoteWeight(discordUserId: string): Promise<{ weight: number; vip: boolean; booster: boolean }> {
  const now = new Date();
  const vipRows = await db.select().from(vipSubscriptionsTable).where(and(eq(vipSubscriptionsTable.discordUserId, discordUserId), gt(vipSubscriptionsTable.expiresAt, now)));
  const boosterRows = await db.select().from(boosterLinksTable).where(and(eq(boosterLinksTable.discordUserId, discordUserId), eq(boosterLinksTable.active, true))).limit(1);
  const vip = vipRows.some(v => !v.discordRoleRemoved && !v.gameVipRemoved);
  const booster = boosterRows.length > 0;
  return { weight: vip || booster ? 2 : 1, vip, booster };
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });
  const channelId = process.env.DISCORD_VIP_MAP_CHANNEL_ID?.trim() || VOTE_CHANNEL_ID;
  const channel = await interaction.client.channels.fetch(channelId).catch(() => null) as TextChannel | null;
  if (!channel?.isSendable()) { await interaction.editReply("❌ Não consegui acessar a sala de votação configurada."); return; }
  const maps: MapOption[] = [1, 2, 3].map(n => {
    const attachment = interaction.options.getAttachment(`imagem${n}`, true);
    if (!attachment.contentType?.startsWith("image/")) throw new Error(`imagem${n} não é uma imagem válida.`);
    return { name: `Mapa ${n}`, image: attachment.url };
  });
  const minutes = parseInt(interaction.options.getString("duracao", true), 10); const endsAt = Date.now() + minutes * 60_000;
  const message = await channel.send({ content: "@everyone", allowedMentions: { parse: ["everyone"] }, embeds: [headerEmbed(endsAt), ...mapEmbeds(maps)], components: rows(maps) });
  const [saved] = await db.insert(mapVotesTable).values({ messageId: message.id, channelId, mapsJson: JSON.stringify(maps), endsAt: new Date(endsAt), status: "active", createdBy: interaction.user.id }).returning();
  if (!saved) throw new Error("Falha ao persistir votação de mapa");
  scheduleRuntime(interaction.client, { id: saved.id, messageId: message.id, channelId, endsAt, maps });
  await announceVote(interaction.client, endsAt);
  await interaction.editReply(`✅ Votação criada em <#${channelId}>.\n⭐ VIP e Booster = **2 votos**.\n💾 Votação e votos salvos no banco — reinícios do bot não interrompem mais a votação.`);
}

export async function handleMapVote(interaction: ButtonInteraction): Promise<void> {
  const vote = await loadVote(interaction.message.id, interaction.client);
  if (!vote) { await interaction.reply({ content: "❌ Esta votação já foi encerrada ou não existe.", ephemeral: true }); return; }
  if (Date.now() >= vote.endsAt) { await finishVote(interaction.client, vote.messageId); await interaction.reply({ content: "⏳ Esta votação acabou de ser encerrada.", ephemeral: true }); return; }
  const option = Number(interaction.customId.split(":")[1]); if (!Number.isInteger(option) || !vote.maps[option]) return;
  const bonus = await getVoteWeight(interaction.user.id);
  const existing = await db.select().from(mapVoteBallotsTable).where(and(eq(mapVoteBallotsTable.mapVoteId, vote.id), eq(mapVoteBallotsTable.discordUserId, interaction.user.id))).limit(1);
  if (existing[0]) await db.update(mapVoteBallotsTable).set({ optionIndex: option, weight: bonus.weight, isVip: bonus.vip, isBooster: bonus.booster, updatedAt: new Date() }).where(eq(mapVoteBallotsTable.id, existing[0].id));
  else await db.insert(mapVoteBallotsTable).values({ mapVoteId: vote.id, discordUserId: interaction.user.id, optionIndex: option, weight: bonus.weight, isVip: bonus.vip, isBooster: bonus.booster });
  const badge = bonus.vip && bonus.booster ? "⭐ VIP + 🚀 Booster" : bonus.vip ? "⭐ VIP" : bonus.booster ? "🚀 Booster" : "👤 voto padrão";
  await interaction.reply({ content: `✅ Voto registrado em **${vote.maps[option].name}**.\n${badge} • seu voto vale **${bonus.weight} voto${bonus.weight > 1 ? "s" : ""}**.\nVocê pode alterar sua escolha até o encerramento.`, ephemeral: true });
}

async function finishVote(client: Client, messageId: string): Promise<void> {
  const vote = await loadVote(messageId); if (!vote) return;
  const runtime = activeVotes.get(messageId); if (runtime?.timer) clearTimeout(runtime.timer); if (runtime?.announcementTimer) clearInterval(runtime.announcementTimer); activeVotes.delete(messageId);
  const ballots = await db.select().from(mapVoteBallotsTable).where(eq(mapVoteBallotsTable.mapVoteId, vote.id));
  const counts = vote.maps.map(() => 0); for (const ballot of ballots) if (counts[ballot.optionIndex] !== undefined) counts[ballot.optionIndex] += ballot.weight;
  await db.update(mapVotesTable).set({ status: "completed" }).where(eq(mapVotesTable.id, vote.id));
  const max = Math.max(...counts); const winners = counts.map((v, i) => v === max ? i : -1).filter(i => i >= 0);
  const channel = await client.channels.fetch(vote.channelId).catch(() => null) as TextChannel | null; if (!channel?.isSendable()) return;
  const msg = await channel.messages.fetch(messageId).catch(() => null); if (msg) await msg.edit({ components: [] }).catch(() => {});
  const result = ballots.length === 0 ? "Nenhum voto foi registrado." : winners.length === 1 ? `🏆 **${vote.maps[winners[0]].name}** venceu a votação!` : `🤝 Empate entre: **${winners.map(i => vote.maps[i].name).join(" • ")}**.`;
  const embed = new EmbedBuilder().setColor(0xe53935).setTitle("🏁 VOTAÇÃO ENCERRADA — RESULTADO")
    .setDescription(`${result}\n\n⭐ Votos de **VIPs e Boosters** foram contabilizados com peso **2**.`)
    .addFields(...vote.maps.map((m, i) => ({ name: `🗺️ ${m.name}`, value: `**${counts[i]} voto(s)**`, inline: true })))
    .setFooter({ text: `Guerra Fria • ${ballots.length} participante(s)` }).setTimestamp();
  await channel.send({ embeds: [embed] });
}

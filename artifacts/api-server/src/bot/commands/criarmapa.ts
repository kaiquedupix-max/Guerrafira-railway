import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionFlagsBits,
  SlashCommandBuilder, type ButtonInteraction, type ChatInputCommandInteraction,
  type Client, type TextChannel,
} from "discord.js";
import { and, eq, gt, isNull, lte } from "drizzle-orm";
import { db, mapVotesTable, mapVoteBallotsTable, vipSubscriptionsTable, boosterLinksTable } from "@workspace/db";
import { executeRconCommand } from "../utils/rcon.js";
import { diagnoseHost, executePreparedWipe, resolveRustMapsUrl } from "../../core/hostWipe.js";

interface MapOption { name: string; image?: string; pageUrl: string; mapUrl: string; }
interface MapVoteRuntime {
  id: number; messageId: string; channelId: string; endsAt: number; wipeAt: number; maps: MapOption[];
  timer?: ReturnType<typeof setTimeout>; announcementTimer?: ReturnType<typeof setInterval>;
}

const activeVotes = new Map<string, MapVoteRuntime>();
const VOTE_CHANNEL_ID = "1537001939504734238";
const CHAT_CHANNEL_ID = "1499084541791436861";
const VIP_ROLE_ID = "1499084540356853917";
const BOOSTER_ROLE_ID = "1536607642364018688";
const ANNOUNCEMENT_INTERVAL = 4 * 60 * 60_000;

const VIP_MENTION = `<@&${VIP_ROLE_ID}>`;
const BOOSTER_MENTION = `<@&${BOOSTER_ROLE_ID}>`;

export const data = new SlashCommandBuilder()
  .setName("criarmapa").setDescription("Cria uma votação de mapa para a comunidade")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addStringOption(o => o.setName("link1").setDescription("Link do Mapa 1 no RustMaps").setRequired(true))
  .addStringOption(o => o.setName("link2").setDescription("Link do Mapa 2 no RustMaps").setRequired(true))
  .addStringOption(o => o.setName("link3").setDescription("Link do Mapa 3 no RustMaps").setRequired(true))
  .addAttachmentOption(o => o.setName("imagem1").setDescription("Imagem opcional do Mapa 1"))
  .addAttachmentOption(o => o.setName("imagem2").setDescription("Imagem opcional do Mapa 2"))
  .addAttachmentOption(o => o.setName("imagem3").setDescription("Imagem opcional do Mapa 3"));

function nextScheduledWipe(now = new Date()): { voteEndsAt: number; wipeAt: number } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year:"numeric", month:"2-digit", day:"2-digit" }).formatToParts(now).filter(p=>p.type!=="literal").map(p=>[p.type,p.value]));
  const base = new Date(Date.UTC(Number(parts.year), Number(parts.month)-1, Number(parts.day), 21, 0));
  for (let add=0; add<8; add++) {
    const candidate = new Date(base.getTime()+add*86_400_000); const day=candidate.getUTCDay();
    if ((day===1||day===5) && candidate.getTime()>now.getTime()) return { voteEndsAt:candidate.getTime(), wipeAt:candidate.getTime()+30*60_000 };
  }
  throw new Error("Não foi possível calcular o próximo wipe.");
}

function headerEmbed(endsAt: number) {
  return new EmbedBuilder().setColor(0xe53935).setTitle("🗺️ GUERRA FRIA 2X — VOTAÇÃO DE MAPA")
    .setDescription(
      "**Vote no mapa que você deseja para o próximo wipe!**\n\n" +
      "📦 **Como votar**\nClique no botão correspondente ao seu mapa favorito. Você pode trocar seu voto enquanto a votação estiver aberta.\n\n" +
      "⭐ **Bônus para cargos especiais**\n" +
      `${VIP_MENTION} e ${BOOSTER_MENTION} têm seu voto contado como **2 votos** em vez de 1.\n` +
      "Se possuir os dois benefícios, o peso continua sendo **2 votos**.\n\n" +
      `⏳ **Encerramento:** <t:${Math.floor(endsAt / 1000)}:R>`
    )
    .setFooter({ text: "Guerra Fria • Votação oficial da comunidade" }).setTimestamp();
}

function mapEmbeds(maps: MapOption[]) {
  const colors = [0xe53935, 0x5865f2, 0x2ecc71];
  return maps.map((m, i) => { const embed=new EmbedBuilder().setColor(colors[i] ?? 0x5865f2).setTitle(`🗺️ ${m.name}`).setURL(m.pageUrl).setDescription(`[Abrir no RustMaps](${m.pageUrl})`); if(m.image)embed.setImage(m.image); return embed; });
}

function rows(maps: MapOption[]) {
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(...maps.map((m, i) =>
    new ButtonBuilder().setCustomId(`mapvote:${i}`).setLabel(m.name).setEmoji(["1️⃣", "2️⃣", "3️⃣"][i] ?? "🗺️")
      .setStyle(i === 0 ? ButtonStyle.Danger : i === 1 ? ButtonStyle.Primary : ButtonStyle.Success)
  ))];
}

function voteMessagePayload(vote: { endsAt: number; maps: MapOption[] }) {
  return {
    content: `@everyone • ${VIP_MENTION} • ${BOOSTER_MENTION}`,
    allowedMentions: { parse: ["everyone"] as ("everyone")[], roles: [VIP_ROLE_ID, BOOSTER_ROLE_ID] },
    embeds: [headerEmbed(vote.endsAt), ...mapEmbeds(vote.maps)],
    components: rows(vote.maps),
  };
}

async function announceVote(client: Client, endsAt: number): Promise<void> {
  if (Date.now() >= endsAt) return;
  const chat = await client.channels.fetch(CHAT_CHANNEL_ID).catch(() => null) as TextChannel | null;
  if (chat?.isSendable()) {
    await chat.send({
      content:
        `🗳️ **VOTAÇÃO DE MAPA ABERTA!**\n` +
        `Acesse <#${VOTE_CHANNEL_ID}> e escolha o mapa do próximo wipe.\n` +
        `⭐ ${VIP_MENTION} e ${BOOSTER_MENTION} valem **2 votos**.\n` +
        `⏳ Encerra <t:${Math.floor(endsAt / 1000)}:R>.`,
      allowedMentions: { roles: [VIP_ROLE_ID, BOOSTER_ROLE_ID] },
    }).catch(() => {});
  }
  await executeRconCommand("say <color=#ff8c00>[GUERRA FRIA]</color> <color=#7CFC00>Vote no mapa do proximo wipe no Discord: discord.gg/guerrafria</color>").catch(() => null);
}

function scheduleRuntime(client: Client, vote: MapVoteRuntime): void {
  const old = activeVotes.get(vote.messageId);
  if (old?.timer) clearTimeout(old.timer);
  if (old?.announcementTimer) clearInterval(old.announcementTimer);
  const remaining = vote.endsAt - Date.now();
  if (remaining <= 0) { finishVote(client, vote.messageId).catch(() => {}); return; }
  vote.timer = setTimeout(() => finishVote(client, vote.messageId).catch(() => {}), remaining);
  vote.announcementTimer = setInterval(() => announceVote(client, vote.endsAt).catch(() => {}), ANNOUNCEMENT_INTERVAL);
  activeVotes.set(vote.messageId, vote);
}

async function loadVote(messageId: string, client?: Client): Promise<MapVoteRuntime | null> {
  const cached = activeVotes.get(messageId); if (cached) return cached;
  const rowsSaved = await db.select().from(mapVotesTable).where(and(eq(mapVotesTable.messageId, messageId), eq(mapVotesTable.status, "active"))).limit(1);
  const saved = rowsSaved[0]; if (!saved) return null;
  let maps: MapOption[]; try { maps = JSON.parse(saved.mapsJson) as MapOption[]; } catch { return null; }
  const vote: MapVoteRuntime = { id: saved.id, messageId: saved.messageId, channelId: saved.channelId, endsAt: saved.endsAt.getTime(), wipeAt: saved.wipeAt?.getTime() || saved.endsAt.getTime()+30*60_000, maps };
  if (client) scheduleRuntime(client, vote);
  return vote;
}

/**
 * Recarrega votações ativas depois de restart/deploy e atualiza a PRÓPRIA mensagem.
 * Não cria votação nova, não apaga votos e não muda o horário de encerramento.
 */
export async function restoreActiveMapVotes(client: Client): Promise<void> {
  const savedVotes = await db.select().from(mapVotesTable).where(eq(mapVotesTable.status, "active"));
  for (const saved of savedVotes) {
    let maps: MapOption[];
    try { maps = JSON.parse(saved.mapsJson) as MapOption[]; } catch { continue; }
    const vote: MapVoteRuntime = {
      id: saved.id,
      messageId: saved.messageId,
      channelId: saved.channelId,
      endsAt: saved.endsAt.getTime(),
      wipeAt: saved.wipeAt?.getTime() || saved.endsAt.getTime()+30*60_000,
      maps,
    };
    if (vote.endsAt <= Date.now()) {
      await finishVote(client, vote.messageId).catch(() => {});
      continue;
    }
    scheduleRuntime(client, vote);
    const channel = await client.channels.fetch(vote.channelId).catch(() => null) as TextChannel | null;
    if (!channel?.isTextBased()) continue;
    const message = await channel.messages.fetch(vote.messageId).catch(() => null);
    if (!message) continue;
    await message.edit(voteMessagePayload(vote)).catch(() => {});
  }
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
  const readiness=await diagnoseHost();
  if(!readiness.capabilities?.startup||!readiness.levelUrlVariable)throw new Error("A host não disponibilizou a variável da URL do mapa. A votação não foi criada para evitar um wipe sem mapa.");
  const channelId = process.env.DISCORD_VIP_MAP_CHANNEL_ID?.trim() || VOTE_CHANNEL_ID;
  const channel = await interaction.client.channels.fetch(channelId).catch(() => null) as TextChannel | null;
  if (!channel?.isSendable()) { await interaction.editReply("❌ Não consegui acessar a sala de votação configurada."); return; }
  const maps: MapOption[] = [];
  for (const n of [1,2,3]) {
    const resolved=await resolveRustMapsUrl(interaction.options.getString(`link${n}`,true)); const attachment=interaction.options.getAttachment(`imagem${n}`);
    if (attachment && !attachment.contentType?.startsWith("image/")) throw new Error(`imagem${n} não é uma imagem válida.`);
    maps.push({name:`Mapa ${n}`,pageUrl:resolved.pageUrl,mapUrl:resolved.mapUrl,image:attachment?.url||resolved.imageUrl});
  }
  const schedule=nextScheduledWipe(); const endsAt=schedule.voteEndsAt;
  const message = await channel.send(voteMessagePayload({ endsAt, maps }));
  const [saved] = await db.insert(mapVotesTable).values({ messageId: message.id, channelId, mapsJson: JSON.stringify(maps), endsAt: new Date(endsAt), wipeAt:new Date(schedule.wipeAt), status: "active", createdBy: interaction.user.id }).returning();
  if (!saved) throw new Error("Falha ao persistir votação de mapa");
  scheduleRuntime(interaction.client, { id: saved.id, messageId: message.id, channelId, endsAt, wipeAt:schedule.wipeAt, maps });
  await announceVote(interaction.client, endsAt);
  await interaction.editReply(`✅ Votação criada em <#${channelId}>.\n🏆 Resultado: <t:${Math.floor(endsAt/1000)}:F>.\n🧊 Wipe automático preparado: <t:${Math.floor(schedule.wipeAt/1000)}:F>.\n⭐ ${VIP_MENTION} e ${BOOSTER_MENTION} = **2 votos**.`);
}

export async function handleMapVote(interaction: ButtonInteraction): Promise<void> {
  const vote = await loadVote(interaction.message.id, interaction.client);
  if (!vote) { await interaction.reply({ content: "❌ Esta votação já foi encerrada ou não existe.", ephemeral: true }); return; }
  if (Date.now() >= vote.endsAt) { await finishVote(interaction.client, vote.messageId); await interaction.reply({ content: "⏳ Esta votação acabou de ser encerrada.", ephemeral: true }); return; }
  const option = Number(interaction.customId.split(":")[1]); if (!Number.isInteger(option) || !vote.maps[option]) return;
  const bonus = await getVoteWeight(interaction.user.id);
  const existing = await db.select().from(mapVoteBallotsTable).where(and(eq(mapVoteBallotsTable.mapVoteId, vote.id), eq(mapVoteBallotsTable.discordUserId, interaction.user.id))).limit(1);
  if (existing[0]) {
    await db.update(mapVoteBallotsTable).set({ optionIndex: option, weight: bonus.weight, isVip: bonus.vip, isBooster: bonus.booster, updatedAt: new Date() }).where(eq(mapVoteBallotsTable.id, existing[0].id));
  } else {
    await db.insert(mapVoteBallotsTable).values({ mapVoteId: vote.id, discordUserId: interaction.user.id, optionIndex: option, weight: bonus.weight, isVip: bonus.vip, isBooster: bonus.booster });
  }
  const badge = bonus.vip && bonus.booster ? `${VIP_MENTION} + ${BOOSTER_MENTION}` : bonus.vip ? VIP_MENTION : bonus.booster ? BOOSTER_MENTION : "👤 voto padrão";
  await interaction.reply({ content: `✅ Voto registrado em **${vote.maps[option].name}**.\n${badge} • seu voto vale **${bonus.weight} voto${bonus.weight > 1 ? "s" : ""}**.\nVocê pode alterar sua escolha até o encerramento.`, ephemeral: true });
}

async function finishVote(client: Client, messageId: string): Promise<void> {
  const vote = await loadVote(messageId); if (!vote) return;
  const runtime = activeVotes.get(messageId);
  if (runtime?.timer) clearTimeout(runtime.timer);
  if (runtime?.announcementTimer) clearInterval(runtime.announcementTimer);
  activeVotes.delete(messageId);
  const ballots = await db.select().from(mapVoteBallotsTable).where(eq(mapVoteBallotsTable.mapVoteId, vote.id));
  const counts = vote.maps.map(() => 0);
  for (const ballot of ballots) if (counts[ballot.optionIndex] !== undefined) counts[ballot.optionIndex] += ballot.weight;
  const max = Math.max(...counts);
  const winners = counts.map((v, i) => v === max ? i : -1).filter(i => i >= 0);
  const winnerIndex = ballots.length ? winners[Math.floor(Math.random()*winners.length)] : 0;
  await db.update(mapVotesTable).set({ status: "selected", winnerIndex }).where(eq(mapVotesTable.id, vote.id));
  const channel = await client.channels.fetch(vote.channelId).catch(() => null) as TextChannel | null;
  if (!channel?.isSendable()) return;
  const msg = await channel.messages.fetch(messageId).catch(() => null);
  if (msg) await msg.edit({ components: [] }).catch(() => {});
  const result = ballots.length === 0 ? `Nenhum voto foi registrado; **${vote.maps[winnerIndex].name}** foi selecionado automaticamente.` : winners.length === 1 ? `🏆 **${vote.maps[winnerIndex].name}** venceu a votação!` : `🤝 Houve empate entre **${winners.map(i => vote.maps[i].name).join(" • ")}**; **${vote.maps[winnerIndex].name}** venceu o desempate automático.`;
  const embed = new EmbedBuilder().setColor(0xe53935).setTitle("🏁 VOTAÇÃO ENCERRADA — RESULTADO")
    .setDescription(`${result}\n\n⭐ Votos de ${VIP_MENTION} e ${BOOSTER_MENTION} foram contabilizados com peso **2**.`)
    .addFields(...vote.maps.map((m, i) => ({ name: `🗺️ ${m.name}`, value: `**${counts[i]} voto(s)**`, inline: true })))
    .setFooter({ text: `Guerra Fria • ${ballots.length} participante(s)` }).setTimestamp();
  await channel.send({ embeds: [embed] });
  const chat = await client.channels.fetch(CHAT_CHANNEL_ID).catch(() => null) as TextChannel | null;
  if(chat?.isSendable()) await chat.send(`🏆 **MAPA VENCEDOR:** [${vote.maps[winnerIndex].name}](${vote.maps[winnerIndex].pageUrl})\n🧊 O wipe será iniciado às <t:${Math.floor(vote.wipeAt/1000)}:t>.`).catch(()=>{});
  await executeRconCommand(`say <color=#ff8c00>[GUERRA FRIA]</color> <color=#7CFC00>${vote.maps[winnerIndex].name} venceu a votacao. Wipe as 18:30.</color>`).catch(()=>null);
}

let wipeScheduler: ReturnType<typeof setInterval> | null = null;
let wipeProcessing=false;const wipeWarnings=new Set<string>();
async function processScheduledWipes(client:Client):Promise<void>{
  if(wipeProcessing||process.env.WIPE_EXECUTION_ENABLED!=="true"||process.env.WIPE_AUTOMATION_ENABLED!=="true")return;wipeProcessing=true;
  try{
  const now=new Date();const upcoming=await db.select().from(mapVotesTable).where(and(eq(mapVotesTable.status,"selected"),isNull(mapVotesTable.appliedAt),gt(mapVotesTable.wipeAt,now),lte(mapVotesTable.wipeAt,new Date(now.getTime()+15*60_000))));
  for(const row of upcoming){let maps:MapOption[];try{maps=JSON.parse(row.mapsJson)}catch{continue}const map=maps[row.winnerIndex??0];if(!map||!row.wipeAt)continue;const remaining=Math.ceil((row.wipeAt.getTime()-Date.now())/1000);const warnings=new Map([[900,"15 minutos"],[600,"10 minutos"],[300,"5 minutos"],[60,"1 minuto"]]);for(const [seconds,label]of warnings){const key=`${row.id}:${seconds}`;if(remaining<=seconds&&remaining>seconds-11&&!wipeWarnings.has(key)){wipeWarnings.add(key);const chat=await client.channels.fetch(CHAT_CHANNEL_ID).catch(()=>null)as TextChannel|null;await Promise.allSettled([chat?.send(`🧊 **WIPE EM ${label.toUpperCase()}**\nO servidor reiniciará com **[${map.name}](${map.pageUrl})**.`),executeRconCommand(`say <color=#ff8c00>[GUERRA FRIA]</color> <color=#ffd65a>Wipe em ${label}. Prepare-se!</color>`)]);}}}
  const due=await db.select().from(mapVotesTable).where(and(eq(mapVotesTable.status,"selected"),isNull(mapVotesTable.appliedAt),lte(mapVotesTable.wipeAt,new Date())));
  for(const row of due){
    let maps:MapOption[];try{maps=JSON.parse(row.mapsJson)}catch{continue} const winner=row.winnerIndex??0; const map=maps[winner];if(!map)continue;
    const chat=await client.channels.fetch(CHAT_CHANNEL_ID).catch(()=>null) as TextChannel|null;
    try{
      await executePreparedWipe("map",map.mapUrl,{id:"AUTOMATION",name:"Wipe automático"},true);
      await db.update(mapVotesTable).set({status:"applied",appliedAt:new Date(),failureReason:null}).where(eq(mapVotesTable.id,row.id));
      await chat?.send(`✅ **WIPE CONCLUÍDO**\nO servidor iniciou com **[${map.name}](${map.pageUrl})** e já está disponível.`).catch(()=>{});
      await executeRconCommand("say <color=#ff8c00>[GUERRA FRIA]</color> <color=#7CFC00>Wipe concluido. Bom jogo!</color>").catch(()=>null);
    }catch(error){
      const reason=error instanceof Error?error.message:"Falha desconhecida";
      await db.update(mapVotesTable).set({status:"failed",failureReason:reason}).where(eq(mapVotesTable.id,row.id));
      await chat?.send(`🚨 **FALHA NO WIPE AUTOMÁTICO**\nA administração foi notificada. Motivo: ${reason}`).catch(()=>{});
    }
  }
  }finally{wipeProcessing=false}
}

export function startMapWipeScheduler(client:Client):void{
  if(wipeScheduler)clearInterval(wipeScheduler);
  processScheduledWipes(client).catch(()=>{});
  wipeScheduler=setInterval(()=>processScheduledWipes(client).catch(()=>{}),10_000);
}

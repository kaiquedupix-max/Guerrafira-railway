import { announceMapVote, announcementFeedChannelIds, generalChatChannelId } from "../mapVoteAnnouncements.js";
import { datedWipeSchedule, serverWipeWindow, localWipeDate, wipeScheduleLabel } from "../../core/wipeCalendar.js";
import { adminServer, withAdminServer, hostSettings } from "../../core/adminServerContext.js";
import { GUERRA_FRIA_SERVERS, parseServerId, type GuerraFriaServerId } from "../../core/servers.js";
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionFlagsBits,
  SlashCommandBuilder, type ButtonInteraction, type ChatInputCommandInteraction,
  type Client, type TextChannel, type Guild,
} from "discord.js";
import { and, eq, gt, isNull, lte, sql } from "drizzle-orm";
import { db, pool, mapVotesTable, mapVoteBallotsTable, vipSubscriptionsTable, boosterLinksTable } from "@workspace/db";
import { diagnoseHost, executePreparedProceduralWipe, executePreparedWipe, prepareProceduralWipeBackup } from "../../core/hostWipe.js";
import { getWipeLockState } from "../../core/wipeLock.js";
import { sendGameAnnouncement } from "../utils/gameAnnouncement.js";
import { logger } from "../../lib/logger.js";

type MapMode = "seed" | "link";
interface MapOption { serverId?: GuerraFriaServerId; name: string; image?: string; mode: MapMode; seed?: number; size?: number; mapUrl?: string; }
export interface MapImageUpload { name: string; mime: string; data: string; }
interface MapVoteRuntime {
  id: number; messageId: string; channelId: string; endsAt: number; wipeAt: number; maps: MapOption[];
  timer?: ReturnType<typeof setTimeout>; announcementTimer?: ReturnType<typeof setInterval>;
}

export interface ForcedVoteResult {
  voteId: number;
  winnerIndex: number;
  winnerName: string;
  winner: MapOption;
  counts: number[];
  participants: number;
  wipeNow: boolean;
  wipeAt: number;
}

const activeVotes = new Map<string, MapVoteRuntime>();
const VOTE_CHANNEL_ID = "1537001939504734238";
const CHAT_CHANNEL_ID = "1499084541791436861";
const VIP_ROLE_ID = "1499084540356853917";
const BOOSTER_ROLE_ID = "1536607642364018688";
const ANNOUNCEMENT_INTERVAL = 60_000; // Delivery state enforces the four-hour reminder interval.
const WIPE_DELAY_MS = 25 * 60_000;
const AUTO_EXECUTION_GRACE_MS = 10 * 60_000;

const VIP_MENTION = `<@&${VIP_ROLE_ID}>`;
const BOOSTER_MENTION = `<@&${BOOSTER_ROLE_ID}>`;

function normalizeMap(raw: any, index: number): MapOption {
  if (raw?.serverId !== undefined && !parseServerId(raw.serverId)) throw new Error("Servidor inválido no mapa salvo; execução bloqueada.");
  const serverId = parseServerId(raw?.serverId) || "solo-duo";
  const mode: MapMode = raw?.mode === "link" || raw?.mapUrl ? "link" : "seed";
  if (mode === "link") return { serverId, name: raw?.name || `Mapa ${index + 1}`, image: raw?.image, mode, mapUrl: String(raw?.mapUrl || "").trim() };
  return { serverId, name: raw?.name || `Mapa ${index + 1}`, image: raw?.image, mode, seed: Number(raw?.seed), size: Number(raw?.size) };
}

function mapDetails(map: MapOption): string {
  return map.mode === "link"
    ? "**Fonte:** `RustMaps .map`"
    : `**Seed:** \`${map.seed}\`\n**Size:** \`${map.size}\``;
}

function mapLogDetails(map: MapOption): string {
  return map.mode === "link" ? `${map.name} • link .map` : `${map.name} • seed ${map.seed} • size ${map.size}`;
}

function announcementChannelIds(includeGeneralChat = false): string[] {
 return [...new Set([...announcementFeedChannelIds(adminServer()),...(includeGeneralChat?[generalChatChannelId(adminServer())]:[])])];
}

async function sendWipeAnnouncement(client: Client, phase: "offline" | "online", map: MapOption): Promise<void> {
  if (adminServer() !== (map.serverId || "solo-duo")) return withAdminServer(map.serverId || "solo-duo", () => sendWipeAnnouncement(client, phase, map));
  const online = phase === "online";
  const embed = new EmbedBuilder()
    .setColor(online ? 0xd6a934 : 0xb45309)
    .setTitle(`${GUERRA_FRIA_SERVERS[map.serverId || "solo-duo"].shortName} • ${online ? "✅ ONLINE APÓS WIPE DE MAPA" : "🧊 WIPE DE MAPA EM ANDAMENTO"}`)
    .setDescription(online
      ? `O Guerra Fria iniciou já wipeado com **${map.name}**.\n\n${mapDetails(map)}\n\nBlueprints foram preservados.`
      : `O servidor foi desligado e o wipe de **${map.name}** começou.\n\n${map.mode === "link" ? "Mapa customizado do RustMaps será carregado pelo link `.map`." : `Seed: \`${map.seed}\` • Size: \`${map.size}\``}\n\nAguarde a confirmação de que ele voltou online.`)
    .setFooter({ text: online ? "Guerra Fria • Bom wipe!" : "Guerra Fria • Wipe em andamento" })
    .setTimestamp();
  const components = online
    ? [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(map.serverId === "trio" ? "status_connect_trio" : "status_connect").setLabel("🎮 Conectar ao servidor").setStyle(ButtonStyle.Success))]
    : [];
  const ids = announcementChannelIds(online);
  await Promise.all(ids.map(async id => {
    const channel = await client.channels.fetch(id).catch(() => null);
    if (!channel?.isSendable()) return;
    await channel.send({ content: "@everyone", allowedMentions: { parse: ["everyone"] }, embeds: [embed], components }).catch(() => {});
  }));
}

export const data = new SlashCommandBuilder()
  .setName("criarmapa").setDescription("Cria uma votação de mapa para a comunidade")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addStringOption(o => o.setName("servidor").setDescription("Servidor que receberá o wipe de mapa").setRequired(true).addChoices({name:"Solo/Duo",value:"solo-duo"},{name:"Trio",value:"trio"}))
  .addStringOption(o => o.setName("data").setDescription("Data: votação 18h e fluxo do wipe 18h25 (AAAA-MM-DD)").setRequired(true))
  .addStringOption(o => o.setName("modo1").setDescription("Fonte do Mapa 1").setRequired(true).addChoices({name:"Seed + Size",value:"seed"},{name:"Link .map",value:"link"}))
  .addStringOption(o => o.setName("modo2").setDescription("Fonte do Mapa 2").setRequired(true).addChoices({name:"Seed + Size",value:"seed"},{name:"Link .map",value:"link"}))
  .addStringOption(o => o.setName("modo3").setDescription("Fonte do Mapa 3").setRequired(true).addChoices({name:"Seed + Size",value:"seed"},{name:"Link .map",value:"link"}))
  .addIntegerOption(o => o.setName("seed1").setDescription("Seed do Mapa 1 (modo seed)").setMinValue(0).setMaxValue(2147483647))
  .addIntegerOption(o => o.setName("size1").setDescription("Size do Mapa 1 (modo seed)").setMinValue(1000).setMaxValue(6000))
  .addStringOption(o => o.setName("mapa1").setDescription("Link .map do Mapa 1 (modo link)"))
  .addIntegerOption(o => o.setName("seed2").setDescription("Seed do Mapa 2 (modo seed)").setMinValue(0).setMaxValue(2147483647))
  .addIntegerOption(o => o.setName("size2").setDescription("Size do Mapa 2 (modo seed)").setMinValue(1000).setMaxValue(6000))
  .addStringOption(o => o.setName("mapa2").setDescription("Link .map do Mapa 2 (modo link)"))
  .addIntegerOption(o => o.setName("seed3").setDescription("Seed do Mapa 3 (modo seed)").setMinValue(0).setMaxValue(2147483647))
  .addIntegerOption(o => o.setName("size3").setDescription("Size do Mapa 3 (modo seed)").setMinValue(1000).setMaxValue(6000))
  .addStringOption(o => o.setName("mapa3").setDescription("Link .map do Mapa 3 (modo link)"))
  .addAttachmentOption(o => o.setName("imagem1").setDescription("Imagem opcional do Mapa 1"))
  .addAttachmentOption(o => o.setName("imagem2").setDescription("Imagem opcional do Mapa 2"))
  .addAttachmentOption(o => o.setName("imagem3").setDescription("Imagem opcional do Mapa 3"));

export function nextScheduledWipe(now = new Date()): { voteEndsAt: number; wipeAt: number } {
 const next=serverWipeWindow(adminServer(),new Date(now.getTime()+30*60000)).next;
 if(!next)throw new Error("Não foi possível calcular o próximo wipe.");
 return datedWipeSchedule(adminServer(),localWipeDate(new Date(next)));
}
export function scheduleForDate(date:string):{voteEndsAt:number;wipeAt:number}{
 const schedule=datedWipeSchedule(adminServer(),date);
 if(schedule.voteEndsAt<=Date.now()+5*60000)throw new Error("Escolha um wipe futuro com pelo menos 5 minutos de antecedência do encerramento da votação.");
 return schedule;
}

function headerEmbed(endsAt: number, server: GuerraFriaServerId = "solo-duo") {
  return new EmbedBuilder().setColor(0xe53935).setTitle(`🗺️ ${GUERRA_FRIA_SERVERS[server].name} — WIPE DE MAPA`)
    .setDescription(
      `**Vote no mapa que você deseja para o próximo wipe! Blueprints serão preservados.**\n**Agenda:** ${wipeScheduleLabel(server)}\n\n` +
      "📦 **Como votar**\nClique no botão correspondente ao seu mapa favorito. Cada pessoa pode votar apenas uma vez.\n\n" +
      "⭐ **Bônus para cargos especiais**\n" +
      `${VIP_MENTION} e ${BOOSTER_MENTION} têm seu voto contado como **2 votos** em vez de 1.\n` +
      "Se possuir os dois benefícios, o peso continua sendo **2 votos**.\n\n" +
      `⏳ **Encerramento:** <t:${Math.floor(endsAt / 1000)}:R>`
    )
    .setFooter({ text: "Guerra Fria • Votação oficial da comunidade" }).setTimestamp();
}

function mapEmbeds(maps: MapOption[]) {
  const colors = [0xe53935, 0x5865f2, 0x2ecc71];
  return maps.map((m, i) => {
    const embed=new EmbedBuilder().setColor(colors[i] ?? 0x5865f2).setTitle(`🗺️ ${m.name}`).setDescription(mapDetails(m));
    if(m.image)embed.setImage(m.image);
    return embed;
  });
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
    embeds: [headerEmbed(vote.endsAt, vote.maps[0]?.serverId), ...mapEmbeds(vote.maps)],
    components: rows(vote.maps),
  };
}

async function announceVote(client:Client,vote:MapVoteRuntime,reminder=false):Promise<void>{
 await announceMapVote(client,{serverId:vote.maps[0]?.serverId||"solo-duo",messageId:vote.messageId,channelId:vote.channelId,endsAt:vote.endsAt,reminder});
}

function scheduleRuntime(client: Client, vote: MapVoteRuntime): void {
  const old = activeVotes.get(vote.messageId);
  if (old?.timer) clearTimeout(old.timer);
  if (old?.announcementTimer) clearInterval(old.announcementTimer);
  const remaining = vote.endsAt - Date.now();
  if (remaining <= 0) { finishVote(client, vote.messageId).catch(() => {}); return; }
  vote.timer = setTimeout(() => finishVote(client, vote.messageId).catch(() => {}), remaining);
  vote.announcementTimer = setInterval(() => announceVote(client, vote, true).catch(() => {}), ANNOUNCEMENT_INTERVAL);
  activeVotes.set(vote.messageId, vote);
}
async function loadVote(messageId: string, client?: Client): Promise<MapVoteRuntime | null> {
  const cached = activeVotes.get(messageId); if (cached) return cached;
  const rowsSaved = await db.select().from(mapVotesTable).where(and(eq(mapVotesTable.messageId, messageId), eq(mapVotesTable.status, "active"))).limit(1);
  const saved = rowsSaved[0]; if (!saved) return null;
  let maps: MapOption[]; try { maps = (JSON.parse(saved.mapsJson) as any[]).map(normalizeMap); } catch { return null; }
  const vote: MapVoteRuntime = { id: saved.id, messageId: saved.messageId, channelId: saved.channelId, endsAt: saved.endsAt.getTime(), wipeAt: saved.wipeAt?.getTime() || saved.endsAt.getTime()+WIPE_DELAY_MS, maps };
  if (client) scheduleRuntime(client, vote);
  return vote;
}

export function cancelActiveMapVoteRuntime(messageId: string): void {
  const runtime = activeVotes.get(messageId);
  if (runtime?.timer) clearTimeout(runtime.timer);
  if (runtime?.announcementTimer) clearInterval(runtime.announcementTimer);
  activeVotes.delete(messageId);
}

export async function restoreActiveMapVotes(client: Client): Promise<void> {
  await repairActiveVoteWeights(client);
  const savedVotes = await db.select().from(mapVotesTable).where(eq(mapVotesTable.status, "active"));
  for (const saved of savedVotes) {
    let maps: MapOption[];
    try { maps = (JSON.parse(saved.mapsJson) as any[]).map(normalizeMap); } catch { continue; }
    // Preserve ballots while repairing future Trio votes created using the obsolete
    // Wednesday 18:00 / accidental Saturday 18:30 schedule. Never move a wipe into the past.
    if (maps[0]?.serverId === "trio" && saved.endsAt.getTime() > Date.now()) {
      const legacyDate = localWipeDate(saved.endsAt);
      const day = new Date(legacyDate + "T00:00:00Z").getUTCDay();
      const targetDate = day === 6
        ? new Date(Date.parse(legacyDate + "T00:00:00Z") + 86400000).toISOString().slice(0, 10)
        : legacyDate;
      if (day === 0 || day === 3 || day === 6) {
        const desired = datedWipeSchedule("trio", targetDate);
        if (desired.voteEndsAt > Date.now() + 5 * 60000 &&
            (saved.endsAt.getTime() !== desired.voteEndsAt || saved.wipeAt?.getTime() !== desired.wipeAt)) {
          await db.update(mapVotesTable).set({
            endsAt: new Date(desired.voteEndsAt),
            wipeAt: new Date(desired.wipeAt),
          }).where(and(eq(mapVotesTable.id, saved.id), eq(mapVotesTable.status, "active")));
          saved.endsAt = new Date(desired.voteEndsAt);
          saved.wipeAt = new Date(desired.wipeAt);
          logger.warn({ voteId: saved.id, targetDate }, "Future Trio map vote repaired to Wednesday 18:30 / Sunday 13:00");
        }
      }
    }
    const vote: MapVoteRuntime = {
      id: saved.id,
      messageId: saved.messageId,
      channelId: saved.channelId,
      endsAt: saved.endsAt.getTime(),
      wipeAt: saved.wipeAt?.getTime() || saved.endsAt.getTime()+WIPE_DELAY_MS,
      maps,
    };
    const correctedWipeAt=vote.endsAt+WIPE_DELAY_MS;
    if(vote.wipeAt!==correctedWipeAt){vote.wipeAt=correctedWipeAt;await db.update(mapVotesTable).set({wipeAt:new Date(correctedWipeAt)}).where(eq(mapVotesTable.id,vote.id));}
    if (vote.endsAt <= Date.now()) { await finishVote(client, vote.messageId).catch(() => {}); continue; }
    scheduleRuntime(client, vote);
    await announceVote(client,vote);
    const channel = await client.channels.fetch(vote.channelId).catch(() => null) as TextChannel | null;
    if (!channel?.isTextBased()) continue;
    const message = await channel.messages.fetch(vote.messageId).catch(() => null);
    if (!message) continue;
    await message.edit(voteMessagePayload(vote)).catch(() => {});
  }
}

async function getVoteWeight(discordUserId: string, guild: Guild | null): Promise<{ weight: number; vip: boolean; booster: boolean }> {
  const now = new Date();
  const vipRows = await db.select().from(vipSubscriptionsTable).where(and(eq(vipSubscriptionsTable.discordUserId, discordUserId), gt(vipSubscriptionsTable.expiresAt, now)));
  const boosterRows = await db.select().from(boosterLinksTable).where(and(eq(boosterLinksTable.discordUserId, discordUserId), eq(boosterLinksTable.active, true))).limit(1);
  const member = guild ? await guild.members.fetch({ user: discordUserId, force: true }).catch((error: { code?: number }) => {
    if (error.code === 10007) return null;
    throw error;
  }) : null;
  const vip = vipRows.some(v => !v.gameVipRemoved) || Boolean(member?.roles.cache.has(process.env.DISCORD_VIP_ROLE_ID || VIP_ROLE_ID));
  const booster = boosterRows.length > 0 || Boolean(member?.premiumSinceTimestamp)
    || Boolean(member?.roles.cache.has(process.env.DISCORD_BOOSTER_ROLE_ID || BOOSTER_ROLE_ID));
  return { weight: vip || booster ? 2 : 1, vip, booster };
}

/** Promote existing ballots only; never erase a bonus earned when the vote was cast. */
export async function repairActiveVoteWeights(client: Client): Promise<void> {
  const votes = await db.select().from(mapVotesTable).where(eq(mapVotesTable.status, "active"));
  for (const vote of votes) {
    const channel = await client.channels.fetch(vote.channelId);
    if (!channel || !("guild" in channel)) continue;
    const ballots = await db.select().from(mapVoteBallotsTable).where(eq(mapVoteBallotsTable.mapVoteId, vote.id));
    for (const ballot of ballots) {
      const bonus = await getVoteWeight(ballot.discordUserId, channel.guild);
      if (bonus.weight !== 2 || ballot.weight >= 2) continue;
      // The active-state guard prevents rewriting a vote after its result is finalized.
      await pool.query(`UPDATE map_vote_ballots SET weight=2, is_vip=$1, is_booster=$2
        WHERE id=$3 AND weight<2 AND EXISTS (SELECT 1 FROM map_votes WHERE id=$4 AND status='active')`,
        [bonus.vip || ballot.isVip, bonus.booster || ballot.isBooster, ballot.id, vote.id]);
    }
  }
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });
  try{
    const maps = [1,2,3].map(n => ({
      mode: interaction.options.getString(`modo${n}`,true) as MapMode,
      seed: interaction.options.getInteger(`seed${n}`) ?? undefined,
      size: interaction.options.getInteger(`size${n}`) ?? undefined,
      mapUrl: interaction.options.getString(`mapa${n}`)?.trim() || undefined,
    }));
    const serverId = parseServerId(interaction.options.getString("servidor",true));
    if (!serverId) throw new Error("Selecione Solo/Duo ou Trio.");
    const result=await createMapVote(interaction.client,{
      serverId,
      createdBy:interaction.user.id,
      date:interaction.options.getString("data",true),
      maps,
      images:[1,2,3].map(n=>{const a=interaction.options.getAttachment(`imagem${n}`);if(a&&!a.contentType?.startsWith("image/"))throw new Error(`imagem${n} não é uma imagem válida.`);return a?.url}),
    });
    await interaction.editReply(`✅ **${GUERRA_FRIA_SERVERS[serverId].name} — WIPE DE MAPA (blueprints preservados)**\nVotação criada em <#${result.channelId}>.\n🏆 Resultado: <t:${Math.floor(result.endsAt/1000)}:F>.\n🧊 Wipe automático preparado: <t:${Math.floor(result.wipeAt/1000)}:F>.\n⭐ ${VIP_MENTION} e ${BOOSTER_MENTION} = **2 votos**.`);
  }catch(error){await interaction.editReply(`❌ ${error instanceof Error?error.message:"Falha ao criar votação."}`)}
}

export async function createMapVote(client:Client,input:{serverId?:GuerraFriaServerId;createdBy:string;date:string;maps:Array<{mode?:MapMode;seed?:number;size?:number;mapUrl?:string}>;images?:Array<string|undefined>;imageFiles?:Array<MapImageUpload|undefined>;expectedWipeAt?:number}):Promise<{id:number;messageId:string;channelId:string;endsAt:number;wipeAt:number;maps:MapOption[]}>{
  const server = parseServerId(input.serverId ?? adminServer());
  if (!server) throw new Error("Servidor inválido.");
  if (adminServer() !== server) return withAdminServer(server, () => createMapVote(client, input));
  const host = hostSettings();
  if (!host.panelUrl || !host.serverId || !host.apiKey) throw new Error(`Configure a integração do painel de hospedagem do ${GUERRA_FRIA_SERVERS[server].shortName} antes de criar a votação.`);
  if(input.maps.length!==3)throw new Error("Informe exatamente três mapas.");
  const normalizedInput=input.maps.map((raw,i)=>normalizeMap({...raw,serverId:server,name:`Mapa ${i+1}`},i));
  for(const [i,map] of normalizedInput.entries()){
    if(map.mode==="link"){
      if(!map.mapUrl)throw new Error(`Informe o link .map do Mapa ${i+1}.`);
      let url:URL;try{url=new URL(map.mapUrl)}catch{throw new Error(`Link .map do Mapa ${i+1} inválido.`)}
      if(url.protocol!=="https:"&&url.protocol!=="http:")throw new Error(`Link .map do Mapa ${i+1} precisa usar HTTPS.`);
    }else{
      if(!Number.isInteger(map.seed)||Number(map.seed)<0||Number(map.seed)>2147483647)throw new Error(`Seed do Mapa ${i+1} inválida.`);
      if(!Number.isInteger(map.size)||Number(map.size)<1000||Number(map.size)>6000)throw new Error(`Size do Mapa ${i+1} deve estar entre 1000 e 6000.`);
    }
  }
  const readiness=await diagnoseHost();
  if(normalizedInput.some(m=>m.mode==="seed")&&!readiness.capabilities?.proceduralStartup)throw new Error("A host não disponibilizou as variáveis de seed e size para mapas procedurais.");
  if(normalizedInput.some(m=>m.mode==="link")&&!readiness.levelUrlVariable)throw new Error("A host não disponibilizou uma variável LEVEL_URL/MAP_URL para carregar mapas .map.");
  const existing=await db.select({id:mapVotesTable.id,endsAt:mapVotesTable.endsAt}).from(mapVotesTable).where(and(eq(mapVotesTable.status,"active"), sql`COALESCE(${mapVotesTable.mapsJson}::jsonb->0->>'serverId', 'solo-duo') = ${server}`)).limit(1);
  if(existing[0])throw new Error(`Já existe uma votação ativa com encerramento em ${existing[0].endsAt.toLocaleString("pt-BR",{timeZone:"America/Sao_Paulo"})}.`);
  const channelId = server === "trio" ? process.env.TRIO_DISCORD_MAP_CHANNEL_ID?.trim() : process.env.DISCORD_VIP_MAP_CHANNEL_ID?.trim() || VOTE_CHANNEL_ID;
  if (!channelId) throw new Error("Configure TRIO_DISCORD_MAP_CHANNEL_ID para publicar a votação do Trio.");
  const channel = await client.channels.fetch(channelId).catch(() => null) as TextChannel | null;
  if (!channel?.isSendable()) throw new Error("Não consegui acessar a sala de votação configurada.");
  const schedule=scheduleForDate(input.date);
  if(input.expectedWipeAt!==undefined&&input.expectedWipeAt!==schedule.wipeAt)throw new Error("A agenda mudou enquanto a tela estava aberta. Atualize a página e confirme novamente a data do wipe.");
  const maps: MapOption[] = []; const files:Array<{attachment:Buffer;name:string}>=[];
  for (const n of [1,2,3]) {
    const upload=input.imageFiles?.[n-1];let uploadedName:string|undefined;
    if(upload){
      if(!/^image\/(?:png|jpeg|webp|gif)$/i.test(upload.mime))throw new Error(`A imagem do Mapa ${n} precisa ser PNG, JPG, WEBP ou GIF.`);
      const match=/^data:image\/(?:png|jpeg|webp|gif);base64,([A-Za-z0-9+/=]+)$/i.exec(upload.data);
      if(!match)throw new Error(`O arquivo de imagem do Mapa ${n} é inválido.`);
      const attachment=Buffer.from(match[1],"base64");if(!attachment.length||attachment.length>5*1024*1024)throw new Error(`A imagem do Mapa ${n} deve ter no máximo 5 MB.`);
      const ext=upload.mime.toLowerCase()==="image/jpeg"?"jpg":upload.mime.split("/")[1].toLowerCase();uploadedName=`mapa-${n}.${ext}`;files.push({attachment,name:uploadedName});
    }
    maps.push({...normalizedInput[n-1],name:`Mapa ${n}`,image:uploadedName?`attachment://${uploadedName}`:input.images?.[n-1]});
  }
  const endsAt=schedule.voteEndsAt;
  const message = await channel.send({...voteMessagePayload({ endsAt, maps }),files});
  if(files.length){for(const map of maps){if(!map.image?.startsWith("attachment://"))continue;const name=map.image.slice("attachment://".length);const attachment=message.attachments.find(a=>a.name===name);if(attachment)map.image=attachment.url;}await message.edit(voteMessagePayload({endsAt,maps}));}
  try{
    const [saved] = await db.insert(mapVotesTable).values({ messageId: message.id, channelId, mapsJson: JSON.stringify(maps), endsAt: new Date(endsAt), wipeAt:new Date(schedule.wipeAt), status: "active", createdBy: input.createdBy }).returning();
    if (!saved) throw new Error("Falha ao persistir votação de mapa");
    const runtime={ id: saved.id, messageId: message.id, channelId, endsAt, wipeAt:schedule.wipeAt, maps };
    scheduleRuntime(client,runtime);await announceVote(client,runtime);
    return{id:saved.id,messageId:message.id,channelId,endsAt,wipeAt:schedule.wipeAt,maps};
  }catch(error){await message.delete().catch(()=>{});throw error}
}

export async function handleMapVote(interaction: ButtonInteraction): Promise<void> {
  const vote = await loadVote(interaction.message.id, interaction.client);
  if (!vote) { await interaction.reply({ content: "❌ Esta votação já foi encerrada ou não existe.", ephemeral: true }); return; }
  if (Date.now() >= vote.endsAt) { await finishVote(interaction.client, vote.messageId); await interaction.reply({ content: "⏳ Esta votação acabou de ser encerrada.", ephemeral: true }); return; }
  const option = Number(interaction.customId.split(":")[1]); if (!Number.isInteger(option) || !vote.maps[option]) return;
  const existing = await db.select().from(mapVoteBallotsTable).where(and(eq(mapVoteBallotsTable.mapVoteId, vote.id), eq(mapVoteBallotsTable.discordUserId, interaction.user.id))).limit(1);
  if (existing[0]) {
    const chosen = vote.maps[existing[0].optionIndex]?.name || "outro mapa";
    await interaction.reply({ content: `ℹ️ Você já votou nesta votação.\nSeu voto continua registrado em **${chosen}** e não pode ser alterado.`, ephemeral: true });
    return;
  }
  const bonus = await getVoteWeight(interaction.user.id, interaction.guild);
  const inserted = await db.insert(mapVoteBallotsTable).values({ mapVoteId: vote.id, discordUserId: interaction.user.id, optionIndex: option, weight: bonus.weight, isVip: bonus.vip, isBooster: bonus.booster }).onConflictDoNothing().returning({ id: mapVoteBallotsTable.id });
  if (!inserted[0]) { await interaction.reply({ content: "ℹ️ Você já votou nesta votação. Seu primeiro voto foi mantido.", ephemeral: true }); return; }
  const badge = bonus.vip && bonus.booster ? `${VIP_MENTION} + ${BOOSTER_MENTION}` : bonus.vip ? VIP_MENTION : bonus.booster ? BOOSTER_MENTION : "👤 voto padrão";
  await interaction.reply({ content: `✅ Voto registrado em **${vote.maps[option].name}**.\n${badge} • seu voto vale **${bonus.weight} voto${bonus.weight > 1 ? "s" : ""}**.\nCada pessoa pode votar apenas uma vez.`, ephemeral: true });
}

type FinishVoteOptions = { forcedBy?: { id: string; name: string }; wipeNow?: boolean };

async function finishVote(client: Client, messageId: string, options: FinishVoteOptions = {}): Promise<ForcedVoteResult | null> {
  const vote = await loadVote(messageId); if (!vote) return null;
  const server = vote.maps[0]?.serverId || "solo-duo";
  if (adminServer() !== server) return withAdminServer(server, () => finishVote(client, messageId, options));
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
  const forcedWipeAt = options.wipeNow ? new Date() : null;
  await db.update(mapVotesTable).set({
    status: "selected",
    winnerIndex,
    ...(forcedWipeAt ? { wipeAt: forcedWipeAt } : {}),
  }).where(eq(mapVotesTable.id, vote.id));

  const winner=vote.maps[winnerIndex];
  const effectiveWipeAt = forcedWipeAt?.getTime() ?? vote.wipeAt;
  const result = ballots.length === 0
    ? `Nenhum voto foi registrado; **${winner.name}** foi selecionado automaticamente.`
    : winners.length === 1
      ? `🏆 **${winner.name}** venceu a votação!`
      : `🤝 Houve empate entre **${winners.map(i => vote.maps[i].name).join(" • ")}**; **${winner.name}** venceu o desempate automático.`;

  const forcedLine = options.forcedBy
    ? `\n\n🛡️ **Votação encerrada manualmente pelo administrador:** <@${options.forcedBy.id}> (${options.forcedBy.name})`
    : "";
  const wipeLine = options.wipeNow
    ? "\n🚨 **O wipe foi solicitado imediatamente usando o mapa vencedor.**"
    : `\n🧊 O fluxo do wipe permanece programado para <t:${Math.floor(effectiveWipeAt/1000)}:F>.`;

  const channel = await client.channels.fetch(vote.channelId).catch(() => null) as TextChannel | null;
  if (channel?.isSendable()) {
    const msg = await channel.messages.fetch(messageId).catch(() => null);
    if (msg) await msg.edit({ components: [] }).catch(() => {});
    const embed = new EmbedBuilder()
      .setColor(options.forcedBy ? 0xf59e0b : 0xe53935)
      .setTitle(options.forcedBy ? "🛑 VOTAÇÃO ENCERRADA PELO ADMINISTRADOR" : "🏁 VOTAÇÃO ENCERRADA — RESULTADO")
      .setDescription(`**${GUERRA_FRIA_SERVERS[server].name} • WIPE DE MAPA • Blueprints preservados**\n${result}${forcedLine}${wipeLine}\n\n⭐ Votos de ${VIP_MENTION} e ${BOOSTER_MENTION} foram contabilizados com peso **2**.`)
      .addFields(...vote.maps.map((m, i) => ({ name: `🗺️ ${m.name}`, value: `**${counts[i]} voto(s)**`, inline: true })))
      .setFooter({ text: `Guerra Fria • ${ballots.length} participante(s)` }).setTimestamp();
    await channel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => {});
  }

  const chat = await client.channels.fetch(adminServer() === "trio" ? process.env.TRIO_DISCORD_CHAT_CHANNEL_ID || "" : CHAT_CHANNEL_ID).catch(() => null) as TextChannel | null;
  if(chat?.isSendable()) {
    const adminText = options.forcedBy ? `\n🛡️ Encerrada manualmente por <@${options.forcedBy.id}> (${options.forcedBy.name}).` : "";
    const wipeText = options.wipeNow
      ? "\n🚨 O wipe está sendo iniciado agora com o resultado da votação."
      : `\n🧊 O fluxo do wipe será iniciado às <t:${Math.floor(effectiveWipeAt/1000)}:t>.`;
    await chat.send({
      content:`**${GUERRA_FRIA_SERVERS[server].name} • WIPE DE MAPA • Blueprints preservados**\n🏆 **MAPA VENCEDOR:** ${winner.name}\n${winner.mode==="link"?"Fonte: `RustMaps .map`":`Seed: \`${winner.seed}\` • Size: \`${winner.size}\``}${adminText}${wipeText}`,
      allowedMentions:{parse:[]},
    }).catch(()=>{});
  }

  await sendGameAnnouncement(
    "GUERRA FRIA",
    options.wipeNow ? `${winner.name} venceu. Wipe iniciado pela administracao.` : `${winner.name} venceu. Wipe programado normalmente.`,
    "#7CFC00",
  ).catch(()=>null);

  if (options.wipeNow) await processScheduledWipes(client);

  return {
    voteId: vote.id,
    winnerIndex,
    winnerName: winner.name,
    winner,
    counts,
    participants: ballots.length,
    wipeNow: Boolean(options.wipeNow),
    wipeAt: effectiveWipeAt,
  };
}

export async function forceFinishActiveMapVote(
  client: Client,
  admin: { id: string; name: string },
  wipeNow: boolean,
): Promise<ForcedVoteResult> {
  // Compatibilidade com painel antigo: "forçar fim" só fecha a votação.
  // O wipe permanece no horário oficial da segunda/sexta correspondente.
  wipeNow = false;
  if (wipeNow) {
    if (process.env.WIPE_EXECUTION_ENABLED !== "true" || process.env.WIPE_AUTOMATION_ENABLED !== "true") {
      throw new Error("O wipe automático está desativado nas configurações. A votação não foi encerrada.");
    }
    const lock = await getWipeLockState();
    if (!lock.unlocked) throw new Error("O wipe está travado no painel. Destrave antes de forçar o wipe.");
  }

  const rows = await db.select().from(mapVotesTable).where(eq(mapVotesTable.status, "active")).limit(1);
  const row = rows[0];
  if (!row) throw new Error("Não existe votação de mapa ativa para encerrar.");

  // Carrega a votação no runtime para que timers e lembretes sejam cancelados corretamente.
  await loadVote(row.messageId, client);
  const result = await finishVote(client, row.messageId, { forcedBy: admin, wipeNow });
  if (!result) throw new Error("A votação deixou de estar ativa antes da confirmação.");
  return result;
}

let wipeScheduler: ReturnType<typeof setInterval> | null = null;
let wipeProcessing=false;const wipeWarnings=new Set<string>();
const preparedWipeBackups=new Map<number,string>();const backupRetryAt=new Map<number,number>();
const wipeFailureAlerts=new Set<string>();

async function reportWipeFailure(client:Client,voteId:number,stage:string,map:MapOption|undefined,error:unknown,createdBy?:string):Promise<void>{
  const target = map?.serverId || "solo-duo";
  const raw=error instanceof Error?error.message:String(error||"Falha desconhecida");
  const reason=raw.replace(/\bBearer\s+\S+/gi,"Bearer [oculto]").replace(/(Bearer|token|password|secret|authorization)\s*[:=]\s*\S+/gi,"$1: [oculto]").slice(0,1500);
  const key=`${target}:${voteId}:${stage}:${reason}`;if(wipeFailureAlerts.has(key))return;wipeFailureAlerts.add(key);
  logger.error({voteId,stage,mode:map?.mode,seed:map?.seed,size:map?.size,reason},"Automatic wipe failure");
  const description=`**Servidor:** ${GUERRA_FRIA_SERVERS[target].name} • Wipe de mapa\n**Etapa:** ${stage}\n**Votação:** #${voteId}\n${map?`**Mapa:** ${mapLogDetails(map)}\n`:""}**Erro:** ${reason}\n\nO sucesso não será anunciado enquanto a falha não for resolvida.`;
  try{
    const {notifySubscribedAdmins}=await import("../../admin/adminNotifications.js");
    await notifySubscribedAdmins({kind:"system",title:"🚨 Erro no wipe automático",message:description,severity:"critical"},{additionalUserIds:createdBy?[createdBy]:[]});
  }catch(notificationError){logger.error({notificationError,voteId,target},"Private wipe alert failed; no public fallback");}

}

let preparationTableReady=false;
async function ensurePreparationTable():Promise<void>{
  if(preparationTableReady)return;
  await pool.query(`CREATE TABLE IF NOT EXISTS wipe_preparations (
    vote_id INTEGER PRIMARY KEY,
    backup_uuid TEXT NOT NULL,
    seed BIGINT NOT NULL,
    size INTEGER NOT NULL,
    prepared_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);preparationTableReady=true;
}
async function loadPreparedBackup(voteId:number,seed:number,size:number):Promise<string|null>{
  await ensurePreparationTable();const result=await pool.query<{backup_uuid:string;seed:string;size:number}>(`SELECT backup_uuid,seed,size FROM wipe_preparations WHERE vote_id=$1`,[voteId]);const row=result.rows[0];
  if(!row)return null;if(Number(row.seed)!==seed||Number(row.size)!==size){await pool.query(`DELETE FROM wipe_preparations WHERE vote_id=$1`,[voteId]);return null;}return row.backup_uuid;
}
async function savePreparedBackup(voteId:number,backupId:string,seed:number,size:number):Promise<void>{
  await ensurePreparationTable();await pool.query(`INSERT INTO wipe_preparations (vote_id,backup_uuid,seed,size) VALUES ($1,$2,$3,$4) ON CONFLICT (vote_id) DO UPDATE SET backup_uuid=EXCLUDED.backup_uuid,seed=EXCLUDED.seed,size=EXCLUDED.size,prepared_at=NOW()`,[voteId,backupId,seed,size]);
}
async function clearPreparedBackup(voteId:number):Promise<void>{await ensurePreparationTable();await pool.query(`DELETE FROM wipe_preparations WHERE vote_id=$1`,[voteId]);}

export async function executeSelectedMapVoteNow(
  client:Client,
  voteId:number,
  actor:{id:string;name:string},
):Promise<{voteId:number;winnerIndex:number;winnerName:string;mode:MapMode}>{
  if(!Number.isInteger(voteId)||voteId<=0)throw new Error("Votação inválida.");
  if(wipeProcessing)throw new Error("Já existe uma execução de wipe em andamento. Aguarde a conclusão e tente novamente.");

  wipeProcessing=true;
  let attemptedMap:MapOption|undefined;
  try{
    const rows=await db.select().from(mapVotesTable).where(and(
      eq(mapVotesTable.id,voteId),
      eq(mapVotesTable.status,"selected"),
      isNull(mapVotesTable.appliedAt),
    )).limit(1);
    const row=rows[0];
    if(!row)throw new Error("Esta votação não está com um mapa vencedor pendente de wipe.");

    let maps:MapOption[];
    try{maps=(JSON.parse(row.mapsJson) as any[]).map(normalizeMap)}
    catch{throw new Error("Não foi possível carregar os mapas desta votação.");}

    const winnerIndex=row.winnerIndex??0;
    const map=maps[winnerIndex];
    if(!map)throw new Error("O mapa vencedor desta votação não foi encontrado.");
    attemptedMap=map;

    await db.update(mapVotesTable).set({failureReason:null}).where(eq(mapVotesTable.id,row.id));

    if(map.mode==="link"){
      if(!map.mapUrl)throw new Error("O mapa vencedor não possui link .map.");
      await withAdminServer(map.serverId || "solo-duo", () => executePreparedWipe("map",map.mapUrl!,actor,false,{onStopped:()=>sendWipeAnnouncement(client,"offline",map)}));
    }else{
      const seed=Number(map.seed),size=Number(map.size);
      if(!Number.isInteger(seed)||seed<0||seed>2147483647)throw new Error("A seed do mapa vencedor é inválida.");
      if(!Number.isInteger(size)||size<1000||size>6000)throw new Error("O size do mapa vencedor é inválido.");
      const backupId=preparedWipeBackups.get(row.id)||await loadPreparedBackup(row.id,seed,size)||undefined;
      await withAdminServer(map.serverId || "solo-duo", () => executePreparedProceduralWipe("map",seed,size,actor,false,{onStopped:()=>sendWipeAnnouncement(client,"offline",map)},backupId));
    }

    preparedWipeBackups.delete(row.id);
    backupRetryAt.delete(row.id);
    await clearPreparedBackup(row.id).catch(()=>{});
    await db.update(mapVotesTable).set({status:"applied",appliedAt:new Date(),failureReason:null}).where(eq(mapVotesTable.id,row.id));
    try{const {refreshLeaderboardChannel}=await import("../leaderboardChannel.js");await refreshLeaderboardChannel(client)}catch{}
    await sendWipeAnnouncement(client,"online",map);
    await withAdminServer(map.serverId || "solo-duo", () => sendGameAnnouncement("GUERRA FRIA","Wipe de mapa concluido. Bom jogo!","#7CFC00")).catch(()=>null);

    return{voteId:row.id,winnerIndex,winnerName:map.name,mode:map.mode};
  }catch(error){
    const reason=error instanceof Error?error.message:"Falha desconhecida";
    await db.update(mapVotesTable).set({failureReason:`Wipe manual agora: ${reason}`}).where(and(
      eq(mapVotesTable.id,voteId),
      eq(mapVotesTable.status,"selected"),
      isNull(mapVotesTable.appliedAt),
    )).catch(()=>{});
    if(attemptedMap)await reportWipeFailure(client,voteId,"Execução manual do wipe",attemptedMap,error,actor.id);
    throw error;
  }finally{
    wipeProcessing=false;
  }
}

async function processScheduledWipes(client:Client):Promise<void>{
  if(wipeProcessing||process.env.WIPE_EXECUTION_ENABLED!=="true"||process.env.WIPE_AUTOMATION_ENABLED!=="true")return;
  if(!(await getWipeLockState()).unlocked)return;wipeProcessing=true;
  try{
    const now=new Date();
    const pendingScheduleRows=await db.select().from(mapVotesTable).where(and(eq(mapVotesTable.status,"selected"),isNull(mapVotesTable.appliedAt)));
    for(const pending of pendingScheduleRows){
      let canonicalWipeAt:Date;
      try { const target=normalizeMap(JSON.parse(pending.mapsJson)[0],0).serverId || "solo-duo"; canonicalWipeAt=new Date(datedWipeSchedule(target,localWipeDate(pending.endsAt)).wipeAt); } catch(error) { await db.update(mapVotesTable).set({status:"failed",failureReason:error instanceof Error?error.message:"Agenda incompatível"}).where(eq(mapVotesTable.id,pending.id)); continue; }
      if(!pending.wipeAt||pending.wipeAt.getTime()!==canonicalWipeAt.getTime()){
        await db.update(mapVotesTable).set({wipeAt:canonicalWipeAt}).where(eq(mapVotesTable.id,pending.id));
        pending.wipeAt=canonicalWipeAt;
      }
    }
    const upcoming=await db.select().from(mapVotesTable).where(and(eq(mapVotesTable.status,"selected"),isNull(mapVotesTable.appliedAt),gt(mapVotesTable.wipeAt,now),lte(mapVotesTable.wipeAt,new Date(now.getTime()+15*60_000))));
    await Promise.all(upcoming.map(async row => {
      let maps:MapOption[];try{maps=(JSON.parse(row.mapsJson) as any[]).map(normalizeMap)}catch{return}
      const map=maps[row.winnerIndex??0];if(!map||!row.wipeAt)return;
      const remaining=Math.ceil((row.wipeAt.getTime()-Date.now())/1000);const warnings=new Map([[900,"15 minutos"],[600,"10 minutos"],[300,"5 minutos"],[60,"1 minuto"]]);
      for(const [seconds,label]of warnings){const key=`${row.id}:${seconds}`;if(remaining<=seconds&&remaining>seconds-11&&!wipeWarnings.has(key)){wipeWarnings.add(key);await withAdminServer(map.serverId || "solo-duo", () => sendGameAnnouncement("GUERRA FRIA",`Wipe de mapa em ${label}. Blueprints preservados. Prepare-se!`)).catch(()=>null);}}
      if(map.mode!=="seed")return;
      const seed=Number(map.seed),size=Number(map.size);
      if(!preparedWipeBackups.has(row.id)){const saved=await loadPreparedBackup(row.id,seed,size).catch(()=>null);if(saved)preparedWipeBackups.set(row.id,saved);}
      if(remaining<=900&&!preparedWipeBackups.has(row.id)&&Date.now()>=(backupRetryAt.get(row.id)||0)){
        try{const backupId=await withAdminServer(map.serverId || "solo-duo", () => prepareProceduralWipeBackup("map",seed,size,{id:"AUTOMATION",name:"Preparação do wipe automático"}));await savePreparedBackup(row.id,backupId,seed,size);preparedWipeBackups.set(row.id,backupId);backupRetryAt.delete(row.id);await db.update(mapVotesTable).set({failureReason:null}).where(eq(mapVotesTable.id,row.id));}
        catch(error){backupRetryAt.set(row.id,Date.now()+2*60_000);const reason=error instanceof Error?error.message:"Falha ao preparar backup";await db.update(mapVotesTable).set({failureReason:`Preparação do backup: ${reason}`}).where(eq(mapVotesTable.id,row.id));await reportWipeFailure(client,row.id,"Preparação/backup",map,error,row.createdBy);}
      }
    }));

    const due=await db.select().from(mapVotesTable).where(and(eq(mapVotesTable.status,"selected"),isNull(mapVotesTable.appliedAt),gt(mapVotesTable.wipeAt,new Date(now.getTime()-AUTO_EXECUTION_GRACE_MS)),lte(mapVotesTable.wipeAt,new Date())));
    await Promise.all(due.map(async row => {
      let maps:MapOption[];try{maps=(JSON.parse(row.mapsJson) as any[]).map(normalizeMap)}catch{return}
      const winner=row.winnerIndex??0; const map=maps[winner];if(!map)return;
      try{
        if(map.mode==="link"){
          if(!map.mapUrl)throw new Error("O mapa vencedor não possui link .map.");
          await withAdminServer(map.serverId || "solo-duo", () => executePreparedWipe("map",map.mapUrl!,{id:"AUTOMATION",name:"Wipe automático"},true,{onStopped:()=>sendWipeAnnouncement(client,"offline",map)}));
        }else{
          const seed=Number(map.seed),size=Number(map.size);
          const backupId=preparedWipeBackups.get(row.id)||await loadPreparedBackup(row.id,seed,size)||undefined;
          await withAdminServer(map.serverId || "solo-duo", () => executePreparedProceduralWipe("map",seed,size,{id:"AUTOMATION",name:"Wipe automático"},true,{onStopped:()=>sendWipeAnnouncement(client,"offline",map)},backupId));
        }
        preparedWipeBackups.delete(row.id);backupRetryAt.delete(row.id);await clearPreparedBackup(row.id).catch(()=>{});
        await db.update(mapVotesTable).set({status:"applied",appliedAt:new Date(),failureReason:null}).where(eq(mapVotesTable.id,row.id));
        try{const {refreshLeaderboardChannel}=await import("../leaderboardChannel.js");await refreshLeaderboardChannel(client)}catch{}
        await sendWipeAnnouncement(client,"online",map);
        await withAdminServer(map.serverId || "solo-duo", () => sendGameAnnouncement("GUERRA FRIA","Wipe concluido. Bom jogo!","#7CFC00")).catch(()=>null);
      }catch(error){
        preparedWipeBackups.delete(row.id);backupRetryAt.delete(row.id);await clearPreparedBackup(row.id).catch(()=>{});
        const reason=error instanceof Error?error.message:"Falha desconhecida";
        await db.update(mapVotesTable).set({status:"failed",failureReason:reason}).where(eq(mapVotesTable.id,row.id));
        await reportWipeFailure(client,row.id,"Execução do wipe",map,error,row.createdBy);
      }
    }));
  }finally{wipeProcessing=false}
}

export function startMapWipeScheduler(client:Client):void{
  if(wipeScheduler)clearInterval(wipeScheduler);
  const run=()=>processScheduledWipes(client).catch(error=>reportWipeFailure(client,0,"Agendador",undefined,error));
  run();wipeScheduler=setInterval(run,10_000);
}

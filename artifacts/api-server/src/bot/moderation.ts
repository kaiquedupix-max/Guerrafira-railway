import {
  Events,
  PermissionFlagsBits,
  type Client,
  type Message,
} from "discord.js";
import { logger } from "../lib/logger.js";

const URL_REGEX = /(?:https?:\/\/|www\.)\S+|discord(?:app)?\.com\/invite\/\S+|discord\.gg\/\S+/i;
const URL_MATCH_REGEX = /(?:https?:\/\/|www\.)[^\s<>]+|discord(?:app)?\.com\/invite\/[^\s<>]+|discord\.gg\/[^\s<>]+/gi;
const ALLOWED_GIF_HOSTS = new Set([
  "tenor.com",
  "www.tenor.com",
  "media.tenor.com",
  "giphy.com",
  "www.giphy.com",
  "media.giphy.com",
  "i.giphy.com",
  "cdn.discordapp.com",
  "media.discordapp.net",
]);
const ALLOWED_LINK_CATEGORY_IDS = new Set([
  "1530056461877641326",
  "1499084541791436862",
]);
const ALLOWED_LINK_CHANNEL_IDS = new Set([
  "1537001775826075739",
  "1541420295615815720",
]);

function isAdmin(message: Message): boolean {
  return Boolean(message.member?.permissions.has(PermissionFlagsBits.Administrator));
}

function isVip(message: Message): boolean {
  const vipRoleId = process.env.DISCORD_VIP_ROLE_ID?.trim();
  if (!vipRoleId || !message.member) return false;
  return message.member.roles.cache.has(vipRoleId);
}

function isAllowedLinkChannel(message: Message): boolean {
  if (!message.guild) return false;
  if (ALLOWED_LINK_CHANNEL_IDS.has(message.channelId)) return true;
  const channel = message.channel;
  if (!("parentId" in channel)) return false;
  return Boolean(channel.parentId && ALLOWED_LINK_CATEGORY_IDS.has(channel.parentId));
}

function isAllowedGifUrl(rawUrl: string): boolean {
  try {
    const normalizedUrl = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
    const url = new URL(normalizedUrl);
    const host = url.hostname.toLowerCase();
    if (!ALLOWED_GIF_HOSTS.has(host)) return false;

    if (host === "cdn.discordapp.com" || host === "media.discordapp.net") {
      return /\.gif(?:$|[?#])/i.test(url.pathname + url.search + url.hash);
    }

    return true;
  } catch {
    return false;
  }
}

function isGifAttachment(message: Message): boolean {
  return message.attachments.some((attachment) => {
    const contentType = attachment.contentType?.toLowerCase() ?? "";
    const name = attachment.name?.toLowerCase() ?? "";
    return contentType === "image/gif" || name.endsWith(".gif");
  });
}

function hasOnlyGifLinks(content: string): boolean {
  const urls = content.match(URL_MATCH_REGEX) ?? [];
  return urls.length > 0 && urls.every(isAllowedGifUrl);
}

function containsBlockedLink(content: string): boolean {
  const urls = content.match(URL_MATCH_REGEX) ?? [];
  return urls.some(url => !isAllowedGifUrl(url));
}

function normalize(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function isWipeQuestion(content: string): boolean {
  const text = normalize(content);
  if (!text.includes("wipe")) return false;
  const triggers = [
    "quando e o wipe","quando é o wipe","quando vai ser o wipe","quando sera o wipe","quando será o wipe",
    "quando e o proximo wipe","quando é o proximo wipe","quando é o próximo wipe","proximo wipe","próximo wipe",
    "que dia e o wipe","que dia é o wipe","qual dia e o wipe","qual dia é o wipe","dia do wipe","horario do wipe",
    "horário do wipe","que horas e o wipe","que horas é o wipe","quando deu wipe","que dia deu wipe",
  ].map(normalize);
  return triggers.some(trigger => text.includes(trigger)) || /\b(quando|qual dia|que dia|que horas|horario|proximo)\b.*\bwipe\b/.test(text);
}

function getSaoPauloParts(date: Date) {
  const formatter = new Intl.DateTimeFormat("en-CA", {timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false,weekday:"short"});
  const parts = Object.fromEntries(formatter.formatToParts(date).map(p => [p.type, p.value]));
  return {year:Number(parts.year),month:Number(parts.month),day:Number(parts.day),hour:Number(parts.hour),minute:Number(parts.minute),second:Number(parts.second),weekday:parts.weekday};
}
function saoPauloLocalToUtc(year:number,month:number,day:number,hour:number,minute:number):Date{return new Date(Date.UTC(year,month-1,day,hour+3,minute,0));}
function nextWipeDate(now=new Date()):Date{
  const local=getSaoPauloParts(now);const baseUtc=Date.UTC(local.year,local.month-1,local.day,12,0,0);
  for(let offset=0;offset<=7;offset++){const candidateDay=new Date(baseUtc+offset*86_400_000);const weekday=candidateDay.getUTCDay();if(weekday!==1&&weekday!==5)continue;const candidate=saoPauloLocalToUtc(candidateDay.getUTCFullYear(),candidateDay.getUTCMonth()+1,candidateDay.getUTCDate(),18,30);if(candidate.getTime()>now.getTime())return candidate;}
  return saoPauloLocalToUtc(local.year,local.month,local.day+7,18,30);
}
function formatCountdown(target:Date,now=new Date()):string{let diff=Math.max(0,target.getTime()-now.getTime());const days=Math.floor(diff/86_400_000);diff%=86_400_000;const hours=Math.floor(diff/3_600_000);diff%=3_600_000;const minutes=Math.floor(diff/60_000);const parts:string[]=[];if(days)parts.push(`${days} dia${days===1?"":"s"}`);if(hours)parts.push(`${hours} hora${hours===1?"":"s"}`);parts.push(`${minutes} minuto${minutes===1?"":"s"}`);return parts.join(", ");}
function formatWipeDate(date:Date):string{return new Intl.DateTimeFormat("pt-BR",{timeZone:"America/Sao_Paulo",weekday:"long",day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit",hour12:false}).format(date);}

async function handleLinkModeration(message:Message):Promise<boolean>{
  if(!message.guild||message.author.bot||isAdmin(message))return false;
  if(isAllowedLinkChannel(message))return false;

  // VIP pode enviar GIFs normalmente sem abrir exceção para links comuns.
  if(isVip(message) && (isGifAttachment(message) || hasOnlyGifLinks(message.content))) return false;

  if(!URL_REGEX.test(message.content)||!containsBlockedLink(message.content))return false;
  await message.delete().catch(err=>logger.warn({err,messageId:message.id},"Failed to delete blocked link"));
  const warning=await message.channel.send({content:`🚫 <@${message.author.id}>, links não são permitidos neste canal. Use os canais autorizados ou abra um ticket.`}).catch(()=>null);
  if(warning)setTimeout(()=>warning.delete().catch(()=>{}),7_000);
  logger.info({userId:message.author.id,channelId:message.channelId},"Blocked Discord link/message URL");return true;
}
async function handleWipeReply(message:Message):Promise<void>{
  if(!message.guild||message.author.bot||!isWipeQuestion(message.content))return;
  const now=new Date(),next=nextWipeDate(now),unix=Math.floor(next.getTime()/1000),countdown=formatCountdown(next,now);
  await message.reply({content:`🧊 **Próximo wipe — Guerra Fria**\n📅 O próximo wipe será **${formatWipeDate(next)}**.\n⏳ Faltam aproximadamente **${countdown}**.\n🕡 Os wipes acontecem **todas as segundas e sextas-feiras, às 18h30**.\n🔔 <t:${unix}:R>`,allowedMentions:{repliedUser:false}}).catch(err=>logger.warn({err},"Failed to answer wipe question"));
}

async function ensureVipGifPermissions(client: Client): Promise<void> {
  const vipRoleId = process.env.DISCORD_VIP_ROLE_ID?.trim();
  if (!vipRoleId) {
    logger.warn("DISCORD_VIP_ROLE_ID not configured; VIP GIF permission sync skipped");
    return;
  }

  for (const guild of client.guilds.cache.values()) {
    const channels = await guild.channels.fetch().catch(() => null);
    if (!channels) continue;

    for (const channel of channels.values()) {
      if (!channel || channel.isThread() || !channel.isTextBased() || !("permissionOverwrites" in channel)) continue;
      await channel.permissionOverwrites.edit(vipRoleId, { EmbedLinks: true }).catch((err) => {
        logger.warn({ err, guildId: guild.id, channelId: channel.id }, "Failed to grant VIP GIF embed permission");
      });
    }
  }

  logger.info({ vipRoleId }, "VIP GIF permissions synchronized");
}

export function startDiscordModeration(client:Client):void{
  client.on(Events.MessageCreate,async(message)=>{try{if(await handleLinkModeration(message))return;await handleWipeReply(message);}catch(err){logger.error({err},"Discord moderation handler failed");}});
  client.once(Events.ClientReady, () => { void ensureVipGifPermissions(client); });
  logger.info({allowedCategories:[...ALLOWED_LINK_CATEGORY_IDS],allowedChannels:[...ALLOWED_LINK_CHANNEL_IDS]},"Discord moderation and wipe auto-response enabled");
}

import { isWipeQuestion, wipeQuestionServer, buildWipeReply } from "../core/wipeQuestions.js";
import { cachedRead } from "../core/readCache.js";
import {
  Events,
  PermissionFlagsBits,
  type Client,
  type Message,
} from "discord.js";
import { and, eq, gt } from "drizzle-orm";
import { db, pool, vipSubscriptionsTable } from "@workspace/db";
import { logger } from "../lib/logger.js";

const URL_REGEX = /(?:https?:\/\/|www\.)\S+|discord(?:app)?\.com\/invite\/\S+|discord\.gg\/\S+/i;
const URL_MATCH_REGEX = /(?:https?:\/\/|www\.)[^\s<>]+|discord(?:app)?\.com\/invite\/[^\s<>]+|discord\.gg\/[^\s<>]+/gi;
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

async function isVip(message: Message): Promise<boolean> {
  const vipRoleId = process.env.DISCORD_VIP_ROLE_ID?.trim();
  if (vipRoleId && message.member?.roles.cache.has(vipRoleId)) return true;

  // Fallback no banco: evita falso negativo quando o cache de cargos do Discord
  // ainda não atualizou ou o membro acabou de receber o VIP.
  try {
    const [activeVip] = await db
      .select({ id: vipSubscriptionsTable.id })
      .from(vipSubscriptionsTable)
      .where(and(
        eq(vipSubscriptionsTable.discordUserId, message.author.id),
        gt(vipSubscriptionsTable.expiresAt, new Date()),
        eq(vipSubscriptionsTable.gameVipRemoved, false),
      ))
      .limit(1);
    return Boolean(activeVip);
  } catch (err) {
    logger.warn({ err, userId: message.author.id }, "VIP DB fallback check failed");
    return false;
  }
}

function isAllowedLinkChannel(message: Message): boolean {
  if (!message.guild) return false;
  if (ALLOWED_LINK_CHANNEL_IDS.has(message.channelId)) return true;
  const channel = message.channel;
  if (!("parentId" in channel)) return false;
  return Boolean(channel.parentId && ALLOWED_LINK_CATEGORY_IDS.has(channel.parentId));
}

function isGifHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === "tenor.com" || host.endsWith(".tenor.com") ||
    host === "giphy.com" || host.endsWith(".giphy.com") ||
    host === "cdn.discordapp.com" || host === "media.discordapp.net"
  );
}

function isAllowedGifUrl(rawUrl: string): boolean {
  try {
    const normalizedUrl = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
    const url = new URL(normalizedUrl);
    if (!isGifHost(url.hostname)) return false;

    const host = url.hostname.toLowerCase();
    if (host === "cdn.discordapp.com" || host === "media.discordapp.net") {
      return /\.gif(?:$|[?#])/i.test(url.pathname + url.search + url.hash);
    }

    // Tenor/Giphy usam vários subdomínios e nem todo URL termina em .gif
    // (ex.: /view/... ou media1.tenor.com/...). O domínio já identifica o GIF.
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

function hasGifEmbed(message: Message): boolean {
  return message.embeds.some((embed) => {
    const provider = embed.provider?.name?.toLowerCase() ?? "";
    if (provider.includes("tenor") || provider.includes("giphy")) return true;

    const candidates = [embed.url, embed.video?.url, embed.image?.url, embed.thumbnail?.url]
      .filter((value): value is string => Boolean(value));
    return candidates.some((rawUrl) => {
      try {
        const url = new URL(rawUrl);
        return isGifHost(url.hostname) && (
          url.hostname.includes("tenor") ||
          url.hostname.includes("giphy") ||
          /\.gif(?:$|[?#])/i.test(url.pathname + url.search + url.hash)
        );
      } catch {
        return false;
      }
    });
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


async function handleLinkModeration(message:Message):Promise<boolean>{
  if(!message.guild||message.author.bot||isAdmin(message))return false;
  if(isAllowedLinkChannel(message))return false;

  // VIP pode enviar GIF por link, picker do Discord ou upload.
  // Links normais continuam bloqueados: se houver URL não-GIF junto, não entra na exceção.
  const vip = await isVip(message);
  if(vip && (isGifAttachment(message) || hasGifEmbed(message) || hasOnlyGifLinks(message.content))) {
    const urls = message.content.match(URL_MATCH_REGEX) ?? [];
    if (urls.every(isAllowedGifUrl)) return false;
  }

  if(!URL_REGEX.test(message.content)||!containsBlockedLink(message.content))return false;
  await message.delete().catch(err=>logger.warn({err,messageId:message.id},"Failed to delete blocked link"));
  const warning=await message.channel.send({content:`🚫 <@${message.author.id}>, links não são permitidos neste canal. Use os canais autorizados ou abra um ticket.`}).catch(()=>null);
  if(warning)setTimeout(()=>warning.delete().catch(()=>{}),7_000);
  logger.info({userId:message.author.id,channelId:message.channelId,vip},"Blocked Discord link/message URL");return true;
}
async function handleWipeReply(message:Message):Promise<void>{
 if(!message.guild||message.author.bot||!isWipeQuestion(message.content))return;
 const [panels,history]=await Promise.all([
  cachedRead(`wipe-calendar-link:${message.guild.id}`,()=>pool.query("SELECT channel_id,message_id FROM wipe_date_panels WHERE guild_id=$1",[message.guild!.id]),60000).catch(()=>({rows:[]})),
  cachedRead("confirmed-wipe-history",()=>pool.query("SELECT server_id,MAX(created_at) AS last_wipe_at FROM mod_logs WHERE action='WIPE_COMPLETED' GROUP BY server_id"),30000).catch(()=>({rows:[]})),
 ]);
 const panel=panels.rows[0];
 const calendarUrl=panel&&[message.guild.id,panel.channel_id,panel.message_id].every(id=>/^\d{17,20}$/.test(String(id)))?`https://discord.com/channels/${message.guild.id}/${panel.channel_id}/${panel.message_id}`:undefined;
 const lastConfirmed:Partial<Record<"solo-duo"|"trio",Date>>={};
 for(const row of history.rows){if(row.server_id==="trio")lastConfirmed.trio=new Date(row.last_wipe_at);else if(row.server_id==="solo-duo")lastConfirmed["solo-duo"]=new Date(row.last_wipe_at);}
 await message.reply({content:buildWipeReply({server:wipeQuestionServer(message.content,message.channelId),calendarUrl,lastConfirmed}),allowedMentions:{parse:[],repliedUser:false}}).catch(err=>logger.warn({err},"Failed to answer wipe question"));
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

import type { Client } from "discord.js";
import { pool } from "@workspace/db";
import { withAdminServer } from "../core/adminServerContext.js";
import { GUERRA_FRIA_SERVERS, type GuerraFriaServerId } from "../core/servers.js";
import { sendGameAnnouncement } from "./utils/gameAnnouncement.js";
import { logger } from "../lib/logger.js";
export const VOTE_REMINDER_INTERVAL=4*60*60_000;
export function generalChatChannelId(server:GuerraFriaServerId):string{
 return (server==="trio"?process.env.TRIO_DISCORD_GENERAL_CHANNEL_ID:undefined)?.trim()||process.env.DISCORD_GENERAL_CHANNEL_ID?.trim()||"1499084541791436861";
}
export function announcementFeedChannelIds(server:GuerraFriaServerId):string[]{
 const specific=server==="trio"?process.env.TRIO_DISCORD_ANNOUNCEMENTS_CHANNEL_ID?.trim():undefined;
 const shared=[process.env.DISCORD_ANNOUNCEMENTS_CHANNEL_ID,...(process.env.DISCORD_ANNOUNCEMENTS_CHANNEL_IDS||"").split(/[\s,;]+/)];
 return [...new Set((specific?[specific]:shared).map(s=>s?.trim()).filter((s):s is string=>Boolean(s)))];
}
async function resolveFeedChannels(client:Client,server:GuerraFriaServerId):Promise<string[]>{
 const configured=announcementFeedChannelIds(server);if(configured.length)return configured;
 const guildId=process.env.DISCORD_GUILD_ID;if(!guildId)return [];
 try{
  const guild=await client.guilds.fetch(guildId),channels=await guild.channels.fetch();
  const candidates=channels.filter(channel=>{
   if(!channel||!channel.isSendable())return false;
   const name=channel.name.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z]/g,"");
   return ["anuncios","announcements","anunciosgerais"].includes(name);
  });
  if(candidates.size===1){const id=candidates.first()!.id;process.env.DISCORD_ANNOUNCEMENTS_CHANNEL_ID=id;return [id];}
 }catch(error){logger.warn({error,server},"Could not locate existing announcements channel");}
 return [];
}
let ready:Promise<void>|undefined;
function ensureTable():Promise<void>{return ready??=pool.query(`CREATE TABLE IF NOT EXISTS map_vote_announcements (
 vote_message_id TEXT NOT NULL,channel_id TEXT NOT NULL,last_message_id TEXT NOT NULL,last_sent_at TIMESTAMPTZ NOT NULL,
 PRIMARY KEY(vote_message_id,channel_id))`).then(()=>{}).catch(error=>{ready=undefined;throw error;});}
const sending=new Set<string>();
type Delivery={messageId:string;at:Date};
const uncommitted=new Map<string,Delivery>();
async function recordDelivery(voteId:string,channelId:string,delivery:Delivery):Promise<void>{
 await pool.query("INSERT INTO map_vote_announcements(vote_message_id,channel_id,last_message_id,last_sent_at) VALUES($1,$2,$3,$4) ON CONFLICT(vote_message_id,channel_id) DO UPDATE SET last_message_id=EXCLUDED.last_message_id,last_sent_at=EXCLUDED.last_sent_at",[voteId,channelId,delivery.messageId,delivery.at]);
}
export type VoteAnnouncement={serverId:GuerraFriaServerId;messageId:string;channelId:string;endsAt:number;reminder?:boolean};
export async function announceMapVote(client:Client,vote:VoteAnnouncement,now=Date.now()):Promise<void>{
 if(now>=vote.endsAt)return;
 try{
  await ensureTable();const general=generalChatChannelId(vote.serverId),feeds=await resolveFeedChannels(client,vote.serverId);
  if(!feeds.length)logger.warn({server:vote.serverId},"Map vote announcement feed is not configured");
  // Reconcile missing initial announcements on every check; only general chat repeats.
  for(const id of new Set([...feeds,general])){
   const key=`${vote.messageId}:${id}`;if(sending.has(key))continue;sending.add(key);
   try{
    const pending=uncommitted.get(key);
    if(pending){await recordDelivery(vote.messageId,id,pending);uncommitted.delete(key);}
    const {rows}=await pool.query("SELECT last_message_id,last_sent_at FROM map_vote_announcements WHERE vote_message_id=$1 AND channel_id=$2",[vote.messageId,id]);
    const previous=rows[0];
    if(previous&&(!vote.reminder||id!==general||now-new Date(previous.last_sent_at).getTime()<VOTE_REMINDER_INTERVAL))continue;
    const channel=await client.channels.fetch(id);
    if(!channel?.isSendable())throw new Error("Canal sem permissão de envio.");
    if(previous){
     if(!channel.isTextBased()||!("messages" in channel))continue;
     const recent=await channel.messages.fetch({after:previous.last_message_id,limit:100});
     if(!recent.some(message=>!message.author.bot))continue;
    }
    const guildId=("guildId" in channel?channel.guildId:undefined)||process.env.DISCORD_GUILD_ID;
    const link=guildId?`https://discord.com/channels/${guildId}/${vote.channelId}/${vote.messageId}`:`<#${vote.channelId}>`;
    const message=await channel.send({content:`🗳️ **VOTAÇÃO DE MAPA ABERTA!** • ${GUERRA_FRIA_SERVERS[vote.serverId].shortName}\nEscolha o mapa do próximo wipe: ${link}\n⭐ VIP e Booster têm peso **2**.\n⏳ Encerra <t:${Math.floor(vote.endsAt/1000)}:R>.`,allowedMentions:{parse:[]}});
    const delivery={messageId:message.id,at:new Date(now)};
    uncommitted.set(key,delivery);
    await recordDelivery(vote.messageId,id,delivery);uncommitted.delete(key);
    if(id===general)await withAdminServer(vote.serverId,()=>sendGameAnnouncement("GUERRA FRIA","Vote no mapa do próximo wipe no Discord: discord.gg/guerrafria","#7CFC00")).catch(error=>logger.warn({error,server:vote.serverId},"Map vote game reminder failed"));
   }catch(error){logger.warn({error,server:vote.serverId,channelId:id},"Map vote announcement failed; will retry without deleting the vote");}
   finally{sending.delete(key);}
  }
 }catch(error){logger.error({error,server:vote.serverId},"Map vote announcement tracking unavailable; will retry");}
}

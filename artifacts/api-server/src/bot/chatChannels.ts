import { ChannelType, type Client, type TextChannel } from "discord.js";
import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";
export function chatChannelFor(server:"solo-duo"|"trio"):string|undefined {
 const duo=process.env.DISCORD_CHAT_CHANNEL_ID,trio=process.env.TRIO_DISCORD_CHAT_CHANNEL_ID;
 return server==="trio"?(trio&&trio!==duo?trio:undefined):duo;
}
export function chatServerFor(channelId:string):"solo-duo"|"trio"|null {
 if(channelId===chatChannelFor("trio"))return "trio";
 if(channelId===chatChannelFor("solo-duo"))return "solo-duo";
 return null;
}
export function startServerChatChannels(client:Client):void {
 let running=false;
 const reconcile=async()=>{if(running)return;running=true;try{await ensureServerChatChannels(client);}catch(error){logger.error({error},"Could not prepare separate server chats; check Manage Channels permission. Will retry.");}finally{running=false;}};
 void reconcile();setInterval(()=>void reconcile(),60_000).unref();
}
export async function ensureServerChatChannels(client:Client):Promise<void>{
 const guildId=process.env.DISCORD_GUILD_ID;if(!guildId)return;
 await pool.query("CREATE TABLE IF NOT EXISTS gf_bot_settings (key TEXT PRIMARY KEY,value TEXT NOT NULL)");
 const guild=await client.guilds.fetch(guildId),channels=await guild.channels.fetch();
 const duo=channels.get(process.env.DISCORD_CHAT_CHANNEL_ID||"");
 if(!duo||duo.type!==ChannelType.GuildText){logger.warn("Duo chat channel unavailable; Trio channel was not created in an arbitrary category");return;}
 const stored=(await pool.query("SELECT value FROM gf_bot_settings WHERE key='trio_chat_channel'")).rows[0]?.value;
 let trio=channels.get(process.env.TRIO_DISCORD_CHAT_CHANNEL_ID||stored||"");
 if(!trio||trio.id===duo.id||trio.type!==ChannelType.GuildText){
   trio=channels.find(c=>c?.type===ChannelType.GuildText&&c.name==="chat-trio"&&c.parentId===duo.parentId);
 }
 if(!trio){trio=await (duo as TextChannel).clone({name:"chat-trio",reason:"Monitoramento separado do servidor Trio solicitado pela administração"});await trio.setPosition(duo.position+1);}
 if(trio.id===duo.id)throw new Error("Os chats do Duo e Trio precisam de canais diferentes.");
 await pool.query("INSERT INTO gf_bot_settings(key,value) VALUES('trio_chat_channel',$1) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value",[trio.id]);
 process.env.TRIO_DISCORD_CHAT_CHANNEL_ID=trio.id;
 logger.info({duoChannel:duo.id,trioChannel:trio.id},"Separate Duo and Trio chat channels ready");
}
export function parseGameChat(raw:string):{Channel:number;Message:string;UserId:string;Username:string}|null {
 try{const start=raw.indexOf("{");if(start<0)return null;const p=JSON.parse(raw.slice(start));
 if(Number(p.Channel)!==0||!/^7656119\d{10}$/.test(String(p.UserId))||!String(p.Message||"").trim())return null;
 return {Channel:0,Message:String(p.Message),UserId:String(p.UserId),Username:String(p.Username||"Jogador")};
 }catch{return null;}
}

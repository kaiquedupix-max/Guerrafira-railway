import { and, eq, gte } from "drizzle-orm";
import { db, modLogsTable } from "@workspace/db";
import type { Client, TextChannel } from "discord.js";
import { restartHostServer } from "../core/hostWipe.js";
import { logger } from "../lib/logger.js";
import { executeRconCommand } from "./utils/rcon.js";

const TZ="America/Sao_Paulo"; const CHAT_FALLBACK="1499084541791436861";
let timer:ReturnType<typeof setInterval>|null=null;const sent=new Set<string>();let checking=false;

function localParts(date=new Date()):Record<string,string>{return Object.fromEntries(new Intl.DateTimeFormat("en-CA",{timeZone:TZ,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"}).formatToParts(date).filter(p=>p.type!=="literal").map(p=>[p.type,p.value]));}
function schedule(date=new Date()):{key:string,target:number,startOfDay:number}{const p=localParts(date);const key=`${p.year}-${p.month}-${p.day}`;return{key,target:Date.UTC(+p.year,+p.month-1,+p.day,9,0,0),startOfDay:Date.UTC(+p.year,+p.month-1,+p.day,3,0,0)}}
async function discord(client:Client,message:string):Promise<void>{const id=process.env.DISCORD_CHAT_CHANNEL_ID||CHAT_FALLBACK;const ch=await client.channels.fetch(id).catch(()=>null) as TextChannel|null;if(ch?.isSendable())await ch.send(message).catch(error=>logger.warn({error},"Auto-restart Discord warning failed"));}
async function game(message:string):Promise<void>{await executeRconCommand(`say <color=#ff8c00>[ADMINISTRACAO]</color> <color=#ffd65a>${message}</color>`).catch(error=>logger.warn({error},"Auto-restart RCON warning failed"));}
async function alreadyRestarted(startOfDay:number):Promise<boolean>{const rows=await db.select({id:modLogsTable.id}).from(modLogsTable).where(and(eq(modLogsTable.action,"AUTO_RESTART_TRIGGERED"),gte(modLogsTable.createdAt,new Date(startOfDay)))).limit(1);return rows.length>0;}

async function tick(client:Client):Promise<void>{
  if(checking||process.env.AUTO_RESTART_ENABLED!=="true")return;checking=true;
  try{
    const now=Date.now();const s=schedule();const remaining=Math.ceil((s.target-now)/1000);
    const minuteWarnings=new Map([[900,"15 minutos"],[600,"10 minutos"],[300,"5 minutos"],[60,"1 minuto"]]);
    for(const [seconds,label] of minuteWarnings)if(remaining<=seconds&&remaining>seconds-2&&!sent.has(`${s.key}:m:${seconds}`)){sent.add(`${s.key}:m:${seconds}`);await Promise.allSettled([discord(client,`🔄 **RESTART AUTOMÁTICO**\nO servidor será reiniciado em **${label}**, às 6h.`),game(`Restart automatico em ${label}.`)])}
    const gameCountdown=[50,40,30,20,10,9,8,7,6,5,4,3,2,1];
    for(const seconds of gameCountdown)if(remaining<=seconds&&remaining>seconds-2&&!sent.has(`${s.key}:s:${seconds}`)){sent.add(`${s.key}:s:${seconds}`);await game(`Servidor reiniciando em ${seconds} segundo${seconds===1?"":"s"}.`)}
    if(remaining<=0&&remaining>-30&&!sent.has(`${s.key}:restart`)){
      sent.add(`${s.key}:restart`);if(await alreadyRestarted(s.startOfDay))return;
      await restartHostServer({id:"AUTOMATION",name:"Restart diário 06:00"});
    }
    for(const key of sent)if(!key.startsWith(s.key))sent.delete(key);
  }catch(error){logger.error({error},"Daily automatic restart failed")}finally{checking=false}
}

export function startDailyRestartScheduler(client:Client):void{if(timer)clearInterval(timer);tick(client).catch(()=>{});timer=setInterval(()=>tick(client).catch(()=>{}),1_000);logger.info({time:"06:00",timezone:TZ},"Daily restart scheduler started")}

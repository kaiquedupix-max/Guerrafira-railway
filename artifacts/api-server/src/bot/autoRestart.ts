import { and, eq, gte } from "drizzle-orm";
import { db, modLogsTable } from "@workspace/db";
import type { Client } from "discord.js";
import { getHostPowerState, restartHostServer } from "../core/hostWipe.js";
import { adminServer, hostSettings, withAdminServer } from "../core/adminServerContext.js";
import type { GuerraFriaServerId } from "../core/servers.js";
import { notifySubscribedAdmins } from "../admin/adminNotifications.js";
import { logger } from "../lib/logger.js";
import { sendGameAnnouncement } from "./utils/gameAnnouncement.js";

const TZ="America/Sao_Paulo";
let timer:ReturnType<typeof setInterval>|null=null;
const states=new Map<string,{checking:boolean;sent:Set<number>;completed:boolean;previous:number|null;retryAt:number;alerted:boolean}>();
const warningTimes=new Map([[900,"15 minutos"],[300,"5 minutos"],[30,"30 segundos"],[25,"25 segundos"],[20,"20 segundos"],[15,"15 segundos"],[10,"10 segundos"],[5,"5 segundos"]]);
export function dailyRestartSchedule(date=new Date()) {
 const p=Object.fromEntries(new Intl.DateTimeFormat("en-CA",{timeZone:TZ,year:"numeric",month:"2-digit",day:"2-digit",hourCycle:"h23"}).formatToParts(date).filter(p=>p.type!=="literal").map(p=>[p.type,p.value]));
 return {key:`${p.year}-${p.month}-${p.day}`,target:Date.UTC(+p.year,+p.month-1,+p.day,9),startOfDay:Date.UTC(+p.year,+p.month-1,+p.day,3)};
}
async function alreadyRestarted(startOfDay:number):Promise<boolean>{
 const rows=await db.select({id:modLogsTable.id}).from(modLogsTable).where(and(eq(modLogsTable.serverId,adminServer()),eq(modLogsTable.action,"AUTO_RESTART_TRIGGERED"),gte(modLogsTable.createdAt,new Date(startOfDay)))).limit(1);
 return rows.length>0;
}
async function checkServer(server:GuerraFriaServerId,now:Date):Promise<void>{
 const enabled=server==="trio"?process.env.TRIO_AUTO_RESTART_ENABLED??process.env.AUTO_RESTART_ENABLED:process.env.AUTO_RESTART_ENABLED;
 if(enabled==="false")return;
 const host=hostSettings();if(!host.panelUrl||!host.serverId||!host.apiKey)return;
 const schedule=dailyRestartSchedule(now),key=`${server}:${schedule.key}`;
 let state=states.get(key);if(!state){state={checking:false,sent:new Set(),completed:false,previous:null,retryAt:0,alerted:false};states.set(key,state);}
 if(state.checking||state.completed||now.getTime()<state.retryAt)return;
 state.checking=true;
 try{
  const remaining=Math.ceil((schedule.target-now.getTime())/1000);
  if(remaining>0){
   const due=[...warningTimes.keys()].filter(seconds=>!state!.sent.has(seconds)&&remaining<=seconds&&(state!.previous!==null?state!.previous>seconds:remaining>seconds-(seconds>=300?60:5)));
   const seconds=due.at(-1);
   if(seconds!==undefined){
    // A failed RCON warning is retried; never mark an unconfirmed warning as sent.
    await sendGameAnnouncement("ADMINISTRAÇÃO",`Reinício automático às 06h00 em ${warningTimes.get(seconds)}.`);
    for(const threshold of warningTimes.keys())if(threshold>=seconds)state.sent.add(threshold);
   }
  }else if(remaining>-300){
   if(await alreadyRestarted(schedule.startOfDay)){state.completed=true;return;}
   // Do not turn on a server intentionally stopped for wipe or maintenance.
   const power=await getHostPowerState();
   if(power!=="running"){state.completed=true;logger.warn({server,power},"Daily restart skipped: server is not running");return;}
   await sendGameAnnouncement("ADMINISTRAÇÃO","Reinício automático das 06h00 iniciando agora.").catch(error=>logger.warn({error,server},"Final restart warning was not confirmed"));
   await restartHostServer({id:"AUTOMATION",name:"Restart diário 06:00"});
   state.completed=true;
  }
  state.previous=remaining;
 }catch(error){
  state.retryAt=now.getTime()+5000;
  logger.error({error,server},"Daily automatic restart failed; retrying");
  if(!state.alerted){
   state.alerted=true;
   const reason=String(error instanceof Error?error.message:error).replace(/\bBearer\s+\S+/gi,"Bearer [oculto]").replace(/(Bearer|token|password|secret|authorization)\s*[:=]\s*\S+/gi,"$1: [oculto]").slice(0,1000);
   await notifySubscribedAdmins({kind:"system",title:`Falha no reinício diário • ${server==="trio"?"Trio":"Duo"}`,message:`Reinício das 06h00 (Brasília): ${reason}. Será tentado novamente dentro da janela de cinco minutos.`,severity:"critical"}).catch(err=>logger.error({err,server},"Private restart alert failed"));
  }
 }finally{state.checking=false;}
}
export async function runDailyRestartCheck(_client:Client,now=new Date()):Promise<void>{
 const day=dailyRestartSchedule(now).key;
 for(const [key,state]of states)if(!key.endsWith(day)&&!state.checking)states.delete(key);
 await Promise.allSettled((["solo-duo","trio"] as const).map(server=>withAdminServer(server,()=>checkServer(server,now))));
}
export function startDailyRestartScheduler(client:Client):void{
 if(timer)clearInterval(timer);
 void runDailyRestartCheck(client);timer=setInterval(()=>void runDailyRestartCheck(client),1000);timer.unref();
 logger.info({time:"06:00",timezone:TZ,servers:["solo-duo","trio"]},"Daily restart scheduler started");
}

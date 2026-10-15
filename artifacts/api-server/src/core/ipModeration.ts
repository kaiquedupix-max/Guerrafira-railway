import { readFile } from "node:fs/promises";
import { isIP } from "node:net";
import { adminServer, withAdminServer } from "./adminServerContext.js";
import { readHostTextFile, writeHostTextFile, listHostFiles } from "./hostConsole.js";
import { executeRconCommand } from "../bot/utils/rcon.js";
import { knownPlayerAddresses } from "./playerDirectory.js";
import { logger } from "../lib/logger.js";
import type { GuerraFriaServerId } from "./servers.js";
const ready=new Map<string,Promise<void>>();
export function normalizeAddress(value:string):string|null{
 let address=String(value||"").trim();
 if(address.startsWith("[")){const end=address.indexOf("]");if(end<0)return null;address=address.slice(1,end);}
 if(!isIP(address)&&/^\d+\.\d+\.\d+\.\d+:\d+$/.test(address))address=address.slice(0,address.lastIndexOf(":"));
 if(address.toLowerCase().startsWith("::ffff:")&&isIP(address.slice(7))===4)address=address.slice(7);
 return isIP(address)&&address!=="0.0.0.0"&&address!=="::"?address.toLowerCase():null;
}
export function ensureIpModeration():Promise<void>{
 const server=adminServer();let task=ready.get(server);if(task)return task;
 task=(async()=>{
   if((await executeRconCommand("gf.guard.status"))?.includes("GF_GUARD_READY_1"))return;
   const source=await readFile(new URL("../assets/GuerraFriaModeration.cs",import.meta.url),"utf8").catch(()=>readFile(new URL("../../assets/GuerraFriaModeration.cs",import.meta.url),"utf8"));
   const directory=await listHostFiles("/carbon/plugins").then(()=>"/carbon/plugins").catch(()=>"/oxide/plugins");
   const existing=await readHostTextFile(directory,"GuerraFriaModeration.cs").catch(()=>null);
   if(existing?.content!==source)await writeHostTextFile(directory,"GuerraFriaModeration.cs",source);
   for(let attempt=0;attempt<10;attempt++){
     await new Promise(resolve=>setTimeout(resolve,1000));
     if((await executeRconCommand("gf.guard.status"))?.includes("GF_GUARD_READY_1"))return;
   }
   throw new Error("O plugin de bloqueio por IP não confirmou a inicialização. Consulte a compilação do GuerraFriaModeration.cs no Rust.");
 })().catch(error=>{ready.delete(server);throw error;});ready.set(server,task);return task;
}
export async function collectPlayerAddresses(steamId:string):Promise<string[]>{
 const stored=await knownPlayerAddresses(steamId);
 const results=await Promise.allSettled((["solo-duo","trio"] as const).map(server=>withAdminServer(server,async()=>{
   await ensureIpModeration();const raw=await executeRconCommand(`gf.guard.player ${steamId}`);
   try{return JSON.parse(raw||"{}").ip as string;}catch{return "";}
 })));
 return [...new Set([...stored,...results.flatMap(r=>r.status==="fulfilled"?[r.value]:[])].map(normalizeAddress).filter((ip):ip is string=>Boolean(ip)))];
}
export async function protectPlayerIp(input:{steamId:string;reason:string;expiresAt:Date|null;ipAddresses?:string[]}):Promise<boolean>{
 await ensureIpModeration();
 const payload=Buffer.from(JSON.stringify({SteamId:input.steamId,Reason:input.reason,ExpiresAt:input.expiresAt?Math.floor(input.expiresAt.getTime()/1000):0,Ips:input.ipAddresses||[]})).toString("base64");
 const result=await executeRconCommand(`gf.guard.ban ${payload}`);
 const count=/GF_GUARD_BANNED (\d+)/.exec(result||"");
 if(!count){ready.delete(adminServer());throw new Error("O Rust não confirmou o bloqueio por IP.");}
 return Number(count[1])>0;
}
export async function removePlayerIpBan(steamId:string):Promise<void>{
 await ensureIpModeration();
 const result=await executeRconCommand(`gf.guard.unban ${steamId}`);
 if(!result?.includes("GF_GUARD_UNBANNED")){ready.delete(adminServer());throw new Error("O Rust não confirmou a remoção do bloqueio por IP.");}
}
export function warmIpModeration():void{
 for(const server of ["solo-duo","trio"] as GuerraFriaServerId[])void withAdminServer(server,ensureIpModeration).catch(error=>logger.warn({error,server},"IP moderation plugin is not ready"));
}

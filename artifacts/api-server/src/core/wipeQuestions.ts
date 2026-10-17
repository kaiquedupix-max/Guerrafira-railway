import { serverWipeWindow, wipeScheduleLabel } from "./wipeCalendar.js";
import type { GuerraFriaServerId } from "./servers.js";
const normalize=(text:string)=>text.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
export function isWipeQuestion(content:string):boolean{
 const text=normalize(content);
 return /\bwip(?:e(?:s|ou|ado|ar)?|ou|a|ar)\b/.test(text)&&(/\b(quando|qnd|qual|dia|horas|hora|hrs|horario|hoje|amanha|ontem|proximo|ultimo|ja|teve|deu|foi|calendario|registro)\b/.test(text)||/^wip(?:e|ou|a)\s*\?*$/.test(text));
}
export function wipeQuestionServer(content:string,channelId:string):GuerraFriaServerId|undefined{
 const text=normalize(content),trio=/\btrio\b/.test(text),duo=/\b(?:duo|solo)\b/.test(text);
 if(trio!==duo)return trio?"trio":"solo-duo";
 if(trio&&duo)return undefined;
 if([process.env.TRIO_DISCORD_GENERAL_CHANNEL_ID,process.env.TRIO_DISCORD_CHAT_CHANNEL_ID].filter(Boolean).includes(channelId))return "trio";
 return undefined;
}
export function buildWipeReply(input:{server?:GuerraFriaServerId;now?:Date;calendarUrl?:string;lastConfirmed?:Partial<Record<GuerraFriaServerId,Date>>}):string{
 const now=input.now||new Date(),servers=input.server?[input.server]:["solo-duo","trio"] as const;
 const sections=servers.map(server=>{
  const next=serverWipeWindow(server,now).next;
  const confirmed=input.lastConfirmed?.[server];
  return `**${server==="trio"?"Trio":"Solo/Duo"}** — ${wipeScheduleLabel(server)}.\n`+(next?`Próximo wipe de mapa: <t:${Math.floor(next/1000)}:F> (<t:${Math.floor(next/1000)}:R>).`:"Próxima data indisponível.")+(confirmed&&Number.isFinite(confirmed.getTime())?`\nÚltimo wipe confirmado no registro do bot: <t:${Math.floor(confirmed.getTime()/1000)}:F>.`:"\nAinda não há registro de wipe concluído disponível no bot.");
 });
 return `🧊 **Calendário e registro de wipes • Guerra Fria**\n${sections.join("\n\n")}${input.calendarUrl?`\n\n📅 Consulte o calendário completo: ${input.calendarUrl}`:""}`;
}

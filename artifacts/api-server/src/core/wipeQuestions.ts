import { serverWipeWindow, wipeScheduleLabel } from "./wipeCalendar.js";
import type { GuerraFriaServerId } from "./servers.js";
const normalize=(text:string)=>text.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
export function isWipeQuestion(content:string):boolean{
 const text=normalize(content);
 if(text.length>300||/@everyone|@here/.test(text))return false;
 if(!/\bwip(?:e(?:s|ou|ado|ar)?|ou|a|ar)\b/.test(text))return false;
 // Announcements mentioning a future wipe are not questions.
 return /\b(quando|qnd|qual|que horas|que dia|qual horario|qual registro)\b/.test(text)
   || /^(?:o |e |ja |teve |deu |foi )?wip(?:e(?:s|ou|ado|ar)?|ou|a|ar)(?: do | no | de | )?(?:duo|trio|solo)?(?: e| eh)?(?: hoje| amanha| ontem| ja)?\s*\?*$/.test(text)
   || /^(?:ja|hoje|amanha|ontem)\b[^.!\n]{0,70}\bwip(?:e(?:s|ou|ado|ar)?|ou|a|ar)\b[^.!\n]*\??$/.test(text);

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
 return `🧊 **Calendário e registro de wipes • Guerra Fria**\n${sections.join("\n\n")}\n\n**Wipe full:** primeira quinta-feira do mês, às 18h30 (Brasília).${input.calendarUrl?`\n\n📅 Consulte o calendário completo: ${input.calendarUrl}`:""}`;
}

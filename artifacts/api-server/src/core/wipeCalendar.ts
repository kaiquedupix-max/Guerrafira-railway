import type { GuerraFriaServerId } from "./servers.js";
export function wipeCalendar(server: GuerraFriaServerId) {
  // Fixed weekly schedule; stale TRIO_WIPE_DAYS must not block Saturday votes.
  const days = server === "trio" ? [3, 6] : [1, 5];
  const hour = server === "trio" ? Number(process.env.TRIO_WIPE_HOUR || 18) : 18;
  const minute = server === "trio" ? Number(process.env.TRIO_WIPE_MINUTE || 30) : 30;
  if (!days.length || days.some(n=>!Number.isInteger(n)||n<0||n>6) || !Number.isInteger(hour)||hour<0||hour>23||!Number.isInteger(minute)||minute<0||minute>59) throw new Error("Agenda de wipe inválida.");
  return { days, hour, minute };
}
export function localWipeDate(now: Date): string {
  return new Intl.DateTimeFormat("en-CA",{timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit"}).format(now);
}
export function datedWipeSchedule(server:GuerraFriaServerId,date:string){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error("Informe a data no formato AAAA-MM-DD.");
 const [y,m,d]=date.split("-").map(Number),calendar=wipeCalendar(server),day=new Date(Date.UTC(y,m-1,d));
 if(day.getUTCFullYear()!==y||day.getUTCMonth()!==m-1||day.getUTCDate()!==d)throw new Error("Data inválida.");
 if(!calendar.days.includes(day.getUTCDay()))throw new Error(`O wipe do ${server === "trio" ? "Trio" : "Solo/Duo"} ocorre somente em ${wipeScheduleLabel(server)}.`);
 const publicWipeAt=Date.UTC(y,m-1,d,calendar.hour+3,calendar.minute);
 return {publicWipeAt,voteEndsAt:publicWipeAt-30*60000,wipeAt:publicWipeAt-5*60000};
}
export function serverWipeWindow(server:GuerraFriaServerId,now=new Date()){
 const date=localWipeDate(now),[y,m,d]=date.split("-").map(Number),base=Date.UTC(y,m-1,d);
 const candidates:number[]=[];
 for(let offset=-8;offset<=8;offset++){const day=new Date(base+offset*86400000);try{candidates.push(datedWipeSchedule(server,day.toISOString().slice(0,10)).publicWipeAt);}catch{}}
 return {last:candidates.filter(n=>n<=now.getTime()).sort((a,b)=>b-a)[0],next:candidates.filter(n=>n>now.getTime()).sort((a,b)=>a-b)[0]};
}
export function wipeScheduleLabel(server:GuerraFriaServerId):string{
 const c=wipeCalendar(server),names=["domingo","segunda-feira","terça-feira","quarta-feira","quinta-feira","sexta-feira","sábado"];
 return `${c.days.map(d=>names[d]).join(" e ")} às ${String(c.hour).padStart(2,"0")}h${String(c.minute).padStart(2,"0")} (Brasília)`;
}

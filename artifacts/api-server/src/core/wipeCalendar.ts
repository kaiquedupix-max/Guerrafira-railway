import type { GuerraFriaServerId } from "./servers.js";
export function wipeCalendar(server: GuerraFriaServerId) {
  // Official weekly schedule, independent of legacy deployment variables.
  const days = server === "trio" ? [3, 6] : [1, 5];
  // Ambos os servidores têm wipe oficial às 18h30 de Brasília.
  const hour = 18;
  const minute = 30;
  const slots = days.map(day => ({ day, hour, minute }));
  if (!days.length || days.some(n=>!Number.isInteger(n)||n<0||n>6) || !Number.isInteger(hour)||hour<0||hour>23||!Number.isInteger(minute)||minute<0||minute>59) throw new Error("Agenda de wipe inválida.");
  return { days, hour, minute, slots };
}
export function localWipeDate(now: Date): string {
  return new Intl.DateTimeFormat("en-CA",{timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit"}).format(now);
}
export function datedWipeSchedule(server:GuerraFriaServerId,date:string){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error("Informe a data no formato AAAA-MM-DD.");
 const [y,m,d]=date.split("-").map(Number),calendar=wipeCalendar(server),day=new Date(Date.UTC(y,m-1,d));
 if(day.getUTCFullYear()!==y||day.getUTCMonth()!==m-1||day.getUTCDate()!==d)throw new Error("Data inválida.");
 if(!calendar.days.includes(day.getUTCDay()))throw new Error(`O wipe do ${server === "trio" ? "Trio" : "Solo/Duo"} ocorre somente em ${wipeScheduleLabel(server)}.`);
 const slot=calendar.slots.find(slot=>slot.day===day.getUTCDay())!;
 const publicWipeAt=Date.UTC(y,m-1,d,slot.hour+3,slot.minute);
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
 const time=(slot:{hour:number;minute:number})=>`${String(slot.hour).padStart(2,"0")}h${String(slot.minute).padStart(2,"0")}`;
 if(c.slots.every(slot=>slot.hour===c.hour&&slot.minute===c.minute))return `${c.days.map(d=>names[d]).join(" e ")} às ${time(c)} (Brasília)`;
 return `${c.slots.map(slot=>`${names[slot.day]} às ${time(slot)}`).join(" e ")} (Brasília)`;
}

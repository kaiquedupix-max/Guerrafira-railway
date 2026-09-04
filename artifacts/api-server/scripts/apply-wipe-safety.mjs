import fs from "node:fs";

const file = new URL("../src/bot/commands/criarmapa.ts", import.meta.url);
let src = fs.readFileSync(file, "utf8");

function replaceOnce(from, to, label) {
  if (src.includes(to)) return;
  if (!src.includes(from)) throw new Error(`Wipe safety patch failed: ${label} source not found`);
  src = src.replace(from, to);
}

replaceOnce(
  'const WIPE_DELAY_MS = 25 * 60_000;',
  'const WIPE_DELAY_MS = 25 * 60_000;\nconst ONE_DAY_MS = 24 * 60 * 60_000;\nconst AUTO_EXECUTION_GRACE_MS = 10 * 60_000;',
  'constants',
);

replaceOnce(
`export function nextScheduledWipe(now = new Date()): { voteEndsAt: number; wipeAt: number } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year:"numeric", month:"2-digit", day:"2-digit" }).formatToParts(now).filter(p=>p.type!=="literal").map(p=>[p.type,p.value]));
  const base = new Date(Date.UTC(Number(parts.year), Number(parts.month)-1, Number(parts.day), 21, 0));
  for (let add=0; add<8; add++) {
    const candidate = new Date(base.getTime()+add*86_400_000); const day=candidate.getUTCDay();
    if ((day===1||day===5) && candidate.getTime()>now.getTime()) return { voteEndsAt:candidate.getTime(), wipeAt:candidate.getTime()+WIPE_DELAY_MS };
  }
  throw new Error("Não foi possível calcular o próximo wipe.");
}

export function scheduleForDate(date:string):{voteEndsAt:number;wipeAt:number}{
  if(!/^\\d{4}-\\d{2}-\\d{2}$/.test(date))throw new Error("Informe a data no formato AAAA-MM-DD.");
  const [year,month,day]=date.split("-").map(Number);const voteAt=Date.UTC(year,month-1,day,21,0,0);const check=new Date(voteAt);
  if(check.getUTCFullYear()!==year||check.getUTCMonth()!==month-1||check.getUTCDate()!==day)throw new Error("Data inválida.");
  if(voteAt<=Date.now()+5*60_000)throw new Error("Escolha uma data futura com pelo menos 5 minutos de antecedência.");
  return{voteEndsAt:voteAt,wipeAt:voteAt+WIPE_DELAY_MS};
}`,
`export function nextScheduledWipe(now = new Date()): { voteEndsAt: number; wipeAt: number } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year:"numeric", month:"2-digit", day:"2-digit" }).formatToParts(now).filter(p=>p.type!=="literal").map(p=>[p.type,p.value]));
  const today = Date.UTC(Number(parts.year), Number(parts.month)-1, Number(parts.day), 0, 0, 0);
  for (let add=0; add<9; add++) {
    const wipeDay = new Date(today + add*ONE_DAY_MS);
    const dow = wipeDay.getUTCDay();
    if (dow !== 1 && dow !== 5) continue;
    const flowAt = Date.UTC(wipeDay.getUTCFullYear(), wipeDay.getUTCMonth(), wipeDay.getUTCDate(), 21, 25, 0);
    if (flowAt <= now.getTime()) continue;
    return { voteEndsAt: flowAt - ONE_DAY_MS - WIPE_DELAY_MS, wipeAt: flowAt };
  }
  throw new Error("Não foi possível calcular o próximo wipe.");
}

// A data informada é o dia em que a votação encerra às 18:00 BRT.
// O wipe correspondente ocorre no dia seguinte: fluxo técnico 18:25 BRT e horário oficial 18:30 BRT.
export function scheduleForDate(date:string):{voteEndsAt:number;wipeAt:number}{
  if(!/^\\d{4}-\\d{2}-\\d{2}$/.test(date))throw new Error("Informe a data no formato AAAA-MM-DD.");
  const [year,month,day]=date.split("-").map(Number);
  const voteAt=Date.UTC(year,month-1,day,21,0,0);
  const check=new Date(voteAt);
  if(check.getUTCFullYear()!==year||check.getUTCMonth()!==month-1||check.getUTCDate()!==day)throw new Error("Data inválida.");
  if(voteAt<=Date.now()+5*60_000)throw new Error("Escolha uma data futura com pelo menos 5 minutos de antecedência.");
  return{voteEndsAt:voteAt,wipeAt:voteAt+ONE_DAY_MS+WIPE_DELAY_MS};
}`,
  'schedule',
);

src = src.replaceAll('saved.endsAt.getTime()+WIPE_DELAY_MS', 'saved.endsAt.getTime()+ONE_DAY_MS+WIPE_DELAY_MS');
replaceOnce(
  'const correctedWipeAt=vote.endsAt+WIPE_DELAY_MS;',
  'const correctedWipeAt=vote.endsAt+ONE_DAY_MS+WIPE_DELAY_MS;',
  'restore schedule',
);

replaceOnce(
  'const due=await db.select().from(mapVotesTable).where(and(eq(mapVotesTable.status,"selected"),isNull(mapVotesTable.appliedAt),lte(mapVotesTable.wipeAt,new Date())));',
  'const due=await db.select().from(mapVotesTable).where(and(eq(mapVotesTable.status,"selected"),isNull(mapVotesTable.appliedAt),gt(mapVotesTable.wipeAt,new Date(now.getTime()-AUTO_EXECUTION_GRACE_MS)),lte(mapVotesTable.wipeAt,new Date())));',
  'stale execution guard',
);

fs.writeFileSync(file, src);
console.log("Wipe safety patch applied: vote 18:00 BRT, flow next day 18:25 BRT, stale auto-wipes blocked.");

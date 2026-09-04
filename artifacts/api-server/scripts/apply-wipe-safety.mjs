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
  'const WIPE_DELAY_MS = 25 * 60_000;\nconst AUTO_EXECUTION_GRACE_MS = 10 * 60_000;',
  'constants',
);

// Regra oficial do Guerra Fria:
// - a data informada é SEMPRE o próprio dia do wipe;
// - somente segundas e sextas são aceitas;
// - votação encerra 18:00 BRT (21:00 UTC);
// - fluxo técnico começa 18:25 BRT;
// - horário oficial divulgado continua 18:30 BRT.
replaceOnce(
`export function scheduleForDate(date:string):{voteEndsAt:number;wipeAt:number}{
  if(!/^\\d{4}-\\d{2}-\\d{2}$/.test(date))throw new Error("Informe a data no formato AAAA-MM-DD.");
  const [year,month,day]=date.split("-").map(Number);const voteAt=Date.UTC(year,month-1,day,21,0,0);const check=new Date(voteAt);
  if(check.getUTCFullYear()!==year||check.getUTCMonth()!==month-1||check.getUTCDate()!==day)throw new Error("Data inválida.");
  if(voteAt<=Date.now()+5*60_000)throw new Error("Escolha uma data futura com pelo menos 5 minutos de antecedência.");
  return{voteEndsAt:voteAt,wipeAt:voteAt+WIPE_DELAY_MS};
}`,
`export function scheduleForDate(date:string):{voteEndsAt:number;wipeAt:number}{
  if(!/^\\d{4}-\\d{2}-\\d{2}$/.test(date))throw new Error("Informe a data no formato AAAA-MM-DD.");
  const [year,month,day]=date.split("-").map(Number);
  const voteAt=Date.UTC(year,month-1,day,21,0,0);
  const check=new Date(voteAt);
  if(check.getUTCFullYear()!==year||check.getUTCMonth()!==month-1||check.getUTCDate()!==day)throw new Error("Data inválida.");
  const dow=check.getUTCDay();
  if(dow!==1&&dow!==5)throw new Error("O wipe só pode ser agendado para segunda ou sexta-feira.");
  if(voteAt<=Date.now()+5*60_000)throw new Error("Escolha um wipe futuro com pelo menos 5 minutos de antecedência do encerramento da votação.");
  return{voteEndsAt:voteAt,wipeAt:voteAt+WIPE_DELAY_MS};
}`,
  'same-day schedule validation',
);

// O botão/ação "forçar fim da votação" NUNCA pode antecipar o wipe.
// Mesmo que algum cliente antigo envie wipeNow=true, o backend converte para apenas encerrar a votação.
replaceOnce(
`export async function forceFinishActiveMapVote(
  client: Client,
  admin: { id: string; name: string },
  wipeNow: boolean,
): Promise<ForcedVoteResult> {
  if (wipeNow) {`,
`export async function forceFinishActiveMapVote(
  client: Client,
  admin: { id: string; name: string },
  wipeNow: boolean,
): Promise<ForcedVoteResult> {
  // Compatibilidade com painel antigo: "forçar fim" só fecha a votação.
  // O wipe permanece no horário oficial da segunda/sexta correspondente.
  wipeNow = false;
  if (wipeNow) {`,
  'force finish cannot wipe now',
);

// Corrige automaticamente qualquer votação pendente que tenha ficado com wipeAt deslocado
// por versões antigas: canonical = encerramento 18:00 + 25 min, no MESMO dia.
replaceOnce(
`    const now=new Date();
    const upcoming=await db.select().from(mapVotesTable).where(and(eq(mapVotesTable.status,"selected"),isNull(mapVotesTable.appliedAt),gt(mapVotesTable.wipeAt,now),lte(mapVotesTable.wipeAt,new Date(now.getTime()+15*60_000))));`,
`    const now=new Date();
    const pendingScheduleRows=await db.select().from(mapVotesTable).where(and(eq(mapVotesTable.status,"selected"),isNull(mapVotesTable.appliedAt)));
    for(const pending of pendingScheduleRows){
      const canonicalWipeAt=new Date(pending.endsAt.getTime()+WIPE_DELAY_MS);
      if(!pending.wipeAt||pending.wipeAt.getTime()!==canonicalWipeAt.getTime()){
        await db.update(mapVotesTable).set({wipeAt:canonicalWipeAt}).where(eq(mapVotesTable.id,pending.id));
        pending.wipeAt=canonicalWipeAt;
      }
    }
    const upcoming=await db.select().from(mapVotesTable).where(and(eq(mapVotesTable.status,"selected"),isNull(mapVotesTable.appliedAt),gt(mapVotesTable.wipeAt,now),lte(mapVotesTable.wipeAt,new Date(now.getTime()+15*60_000))));`,
  'canonical pending schedule repair',
);

// Wipes atrasados não são executados horas/dias depois por acidente.
replaceOnce(
  'const due=await db.select().from(mapVotesTable).where(and(eq(mapVotesTable.status,"selected"),isNull(mapVotesTable.appliedAt),lte(mapVotesTable.wipeAt,new Date())));',
  'const due=await db.select().from(mapVotesTable).where(and(eq(mapVotesTable.status,"selected"),isNull(mapVotesTable.appliedAt),gt(mapVotesTable.wipeAt,new Date(now.getTime()-AUTO_EXECUTION_GRACE_MS)),lte(mapVotesTable.wipeAt,new Date())));',
  'stale execution guard',
);

fs.writeFileSync(file, src);
console.log("Wipe safety patch applied: vote closes 18:00 BRT on wipe day; technical flow 18:25; force-finish never changes wipe time.");

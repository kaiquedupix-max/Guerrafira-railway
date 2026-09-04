import fs from "node:fs";

const files = [
  "../src/routes/seasonPage.ts",
  "../src/routes/seasonGuide.ts",
  "../src/routes/seasonProductionRegistration.ts",
  "../src/routes/seasonOfficialRegistration.ts",
  "../src/admin/homePage.ts",
  "../src/admin/homePageEnhanced.ts",
  "../src/admin/communityPage.ts",
];

const marker = "gf-season-live-transition-v1";
const liveScript = `<script data-gf-season-live="${marker}">(function(){
const START=Date.parse('2026-09-04T18:30:00-03:00');
function apply(){if(Date.now()<START)return;
 document.querySelectorAll('.resetNotice').forEach(e=>e.remove());
 const replacements=[
  ['A Season 1 oficial começa em 04/09 às 18:30.','A Season 1 oficial já começou e o ranking está valendo.'],
  ['A temporada oficial começa em 04/09/2026 às 18:30','A temporada oficial está em andamento desde 04/09/2026 às 18:30'],
  ['O beta atual serve para testes.','A Season 1 oficial já está em andamento.'],
  ['Toda a pontuação atual será zerada em 04/09, antes do início oficial da Season 1 às 18:30. Todos começarão a Season oficial com 0 XP.','A Season 1 oficial já começou. A pontuação exibida agora é a pontuação válida da competição.'],
  ['começa em 04/09 às 18:30','já começou e está em andamento'],
  ['começa em 04/09/2026 às 18:30','está em andamento desde 04/09/2026 às 18:30']
 ];
 const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let n;while(n=w.nextNode()){let t=n.nodeValue||'';for(const [a,b] of replacements)t=t.split(a).join(b);n.nodeValue=t}
 const first=document.querySelector('.quick .q');if(first){const s=first.querySelector('small'),b=first.querySelector('b');if(s)s.textContent='STATUS';if(b)b.textContent='SEASON EM ANDAMENTO'}
 document.querySelectorAll('[data-season-pending],.seasonPending,.preSeasonNotice').forEach(e=>e.remove());
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',apply);else apply();setInterval(apply,30000);
})();</script>`;

for (const rel of files) {
  const file = new URL(rel, import.meta.url);
  if (!fs.existsSync(file)) continue;
  let src = fs.readFileSync(file, "utf8");
  if (src.includes(marker)) continue;
  if (!src.includes("Season") || !src.includes("</body></html>")) continue;
  src = src.replace("</body></html>", `${liveScript}</body></html>`);
  fs.writeFileSync(file, src);
  console.log(`Season live UI transition injected into ${rel}`);
}

import { Router, type IRouter } from "express";
import { db, playerStatsTable } from "@workspace/db";

const router: IRouter = Router();
type Row = typeof playerStatsTable.$inferSelect;

function num(v: unknown): number { return Number(v ?? 0) || 0; }
function publicPlayer(row: Row, value: number, secondary?: string) {
  return { steamId: row.steamId, playerName: row.playerName, value, secondary: secondary ?? null };
}

router.get("/leaderboard", async (_req, res) => {
  try {
    const rows = await db.select().from(playerStatsTable);
    const top = (mapper: (r: Row) => number, filter?: (r: Row) => boolean, secondary?: (r: Row) => string) => rows
      .filter((r) => filter ? filter(r) : true)
      .map((r) => ({ row: r, value: mapper(r) }))
      .filter((x) => x.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 10)
      .map((x) => publicPlayer(x.row, x.value, secondary?.(x.row)));

    const hs = rows
      .filter((r) => num(r.kills) >= 10)
      .map((r) => ({ row: r, value: num(r.kills) > 0 ? (num(r.headshots) / num(r.kills)) * 100 : 0 }))
      .sort((a, b) => b.value - a.value || num(b.row.kills) - num(a.row.kills))
      .slice(0, 10)
      .map((x) => publicPlayer(x.row, Number(x.value.toFixed(1)), `${num(x.row.headshots)} HS / ${num(x.row.kills)} kills`));

    const kd = rows
      .filter((r) => num(r.kills) >= 5)
      .map((r) => ({ row: r, value: num(r.kills) / Math.max(1, num(r.deaths)) }))
      .sort((a, b) => b.value - a.value || num(b.row.kills) - num(a.row.kills))
      .slice(0, 10)
      .map((x) => publicPlayer(x.row, Number(x.value.toFixed(2)), `${num(x.row.kills)} K / ${num(x.row.deaths)} D`));

    const categories = {
      kills: top((r) => num(r.kills)),
      kd,
      hs,
      headshots: top((r) => num(r.headshots), undefined, (r) => `${num(r.kills)} kills`),
      raid: top((r) => num(r.c4Used) + num(r.rocketsUsed), undefined, (r) => `${num(r.c4Used)} C4 • ${num(r.rocketsUsed)} rockets`),
      c4: top((r) => num(r.c4Used)),
      rockets: top((r) => num(r.rocketsUsed)),
      wood: top((r) => num(r.woodGathered)),
      stone: top((r) => num(r.stoneGathered)),
      metal: top((r) => num(r.metalOreGathered)),
      sulfur: top((r) => num(r.sulfurOreGathered)),
      scrap: top((r) => num(r.scrapGathered)),
      gunpowder: top((r) => num(r.gunpowderCrafted)),
      explosives: top((r) => num(r.explosivesCrafted)),
      farm: top((r) => num(r.woodGathered) + num(r.stoneGathered) + num(r.metalOreGathered) + num(r.sulfurOreGathered) + num(r.scrapGathered)),
      deaths: top((r) => num(r.deaths)),
    };

    const totalKills = rows.reduce((s, r) => s + num(r.kills), 0);
    const totalFarm = rows.reduce((s, r) => s + num(r.woodGathered) + num(r.stoneGathered) + num(r.metalOreGathered) + num(r.sulfurOreGathered) + num(r.scrapGathered), 0);
    const totalRaid = rows.reduce((s, r) => s + num(r.c4Used) + num(r.rocketsUsed), 0);
    const activePlayers = rows.filter((r) => num(r.kills) + num(r.resourcesGathered) + num(r.gunpowderCrafted) + num(r.c4Used) + num(r.rocketsUsed) > 0).length;

    res.json({
      updatedAt: new Date().toISOString(),
      summary: {
        activePlayers,
        totalKills,
        totalFarm,
        totalRaid,
        leader: categories.kills[0]?.playerName ?? null,
        raidLeader: categories.raid[0]?.playerName ?? null,
      },
      categories,
    });
  } catch {
    res.status(500).json({ error: "Falha ao carregar leaderboard" });
  }
});

export const leaderboardHtml = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><meta name="theme-color" content="#100c18"/><title>Guerra Fria — Leaderboard</title>
<style>
:root{--bg:#08060d;--panel:#100d18;--line:#2a2238;--text:#fbf9ff;--muted:#9d94ae;--purple:#8b5cf6;--yellow:#ffd84d;--silver:#c9c4d3;--bronze:#d58a50}
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;min-height:100vh;color:var(--text);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:radial-gradient(circle at 50% -15%,#321765 0,#130d20 25%,#09070f 58%,#060509 100%)}body:before{content:"";position:fixed;inset:0;pointer-events:none;background:linear-gradient(120deg,transparent 0 48%,#8b5cf605 49% 51%,transparent 52%)}
.wrap{width:min(1180px,calc(100% - 28px));margin:auto;padding:30px 0 70px}.top{display:flex;align-items:center;justify-content:space-between;gap:18px}.brand{display:flex;align-items:center;gap:13px}.mark{width:49px;height:49px;border:1px solid #5f42a1;background:linear-gradient(145deg,#24143f,#100b18);border-radius:12px;display:grid;place-items:center;font-weight:950;color:var(--yellow);box-shadow:0 0 32px #8b5cf62a,inset 0 0 20px #8b5cf616}.brand h1{font-size:19px;margin:0;letter-spacing:.16em}.brand p{margin:4px 0 0;color:#aa9dbc;font-size:11px;letter-spacing:.11em}.live{font-size:11px;color:#b7acc8;display:flex;align-items:center;gap:8px;border:1px solid #31273f;background:#0f0b17;padding:9px 12px;border-radius:999px}.dot{width:7px;height:7px;border-radius:50%;background:var(--yellow);box-shadow:0 0 13px var(--yellow)}
.hero{text-align:center;margin:58px auto 28px;max-width:840px}.eyebrow{color:var(--yellow);font-size:10px;font-weight:900;letter-spacing:.28em;text-transform:uppercase}.hero h2{font-size:clamp(38px,7vw,72px);line-height:.93;margin:14px 0 15px;letter-spacing:-.055em}.hero h2 span{background:linear-gradient(90deg,#a78bfa,#7c3aed 55%,#ffd84d);-webkit-background-clip:text;background-clip:text;color:transparent}.hero p{color:#a59ab6;font-size:14px;line-height:1.65;margin:auto;max-width:680px}
.stats{display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin:34px 0 24px}.stat{background:linear-gradient(180deg,#151020,#0e0a15);border:1px solid #2c2340;border-radius:13px;padding:16px;min-width:0}.stat small{display:block;color:#80758f;text-transform:uppercase;letter-spacing:.12em;font-size:8px;font-weight:900}.stat strong{display:block;font-size:20px;margin-top:7px;letter-spacing:-.03em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.stat.leader strong{color:var(--yellow);font-size:14px}.stat.raid{border-color:#59461f;background:linear-gradient(180deg,#211b12,#100c14)}.stat.raid strong{color:var(--yellow)}
.tabs{display:flex;gap:8px;overflow:auto;padding:4px 2px 13px;margin:18px 0 20px;scrollbar-width:none}.tab{white-space:nowrap;border:1px solid #2b2338;background:#0e0b15;color:#a89db9;border-radius:9px;padding:10px 14px;font-weight:800;font-size:11px;cursor:pointer;transition:.18s}.tab:hover{border-color:#60479a;color:#fff;transform:translateY(-1px)}.tab.active{background:linear-gradient(135deg,#29164d,#181024);border-color:#8b5cf6;color:#fff;box-shadow:0 0 22px #8b5cf622}.tab.active:after{content:"";display:inline-block;width:5px;height:5px;border-radius:50%;background:var(--yellow);margin-left:8px;vertical-align:1px}
.sectionHead{display:flex;align-items:end;justify-content:space-between;margin:10px 2px 12px}.sectionHead h3{margin:0;font-size:18px}.sectionHead p{margin:4px 0 0;color:#7f748d;font-size:11px}.metricBadge{font-size:10px;font-weight:900;color:#1b1426;background:var(--yellow);padding:7px 10px;border-radius:7px;letter-spacing:.08em;text-transform:uppercase}
.podium{display:grid;grid-template-columns:repeat(3,1fr);gap:13px;align-items:end;margin-bottom:16px}.pod{border:1px solid #2c243a;background:linear-gradient(180deg,#171221,#0d0a13);border-radius:15px;padding:21px 18px;position:relative;overflow:hidden;min-height:157px}.pod:before{content:"";position:absolute;width:130px;height:130px;border-radius:50%;right:-55px;top:-65px;background:#8b5cf61b;filter:blur(3px)}.pod.first{min-height:185px;border-color:#74602e;box-shadow:0 0 35px #ffd84d0d}.pod.first:before{background:#ffd84d17}.rank{font-size:10px;font-weight:950;letter-spacing:.17em;color:#7e738e}.medal{font-size:27px;margin:10px 0 5px}.name{font-size:17px;font-weight:900;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.value{font-size:27px;font-weight:950;margin-top:7px;letter-spacing:-.04em}.first .value{color:var(--yellow)}.second .value{color:var(--silver)}.third .value{color:var(--bronze)}.podsub{color:#776d84;font-size:10px;margin-top:5px}
.table{border:1px solid #2b2339;background:#0d0a13;border-radius:15px;overflow:hidden}.thead,.row{display:grid;grid-template-columns:64px 1fr 170px;align-items:center;gap:14px}.thead{padding:13px 18px;background:#15101d;color:#766b85;font-size:9px;text-transform:uppercase;font-weight:950;letter-spacing:.16em}.row{padding:15px 18px;border-top:1px solid #211a2b;transition:.15s}.row:hover{background:#15101e}.row.toprow{background:linear-gradient(90deg,#21133a55,transparent)}.pos{font-size:13px;color:#8d819d;font-weight:900}.pos.top{color:var(--yellow)}.pname{font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.steam{color:#655b72;font-size:10px;margin-top:3px}.score{text-align:right;font-weight:950;font-size:16px}.sub{color:#766b83;font-size:10px;font-weight:500;margin-top:2px}.empty{padding:55px;text-align:center;color:#756a84}.footer{text-align:center;color:#50475c;font-size:10px;margin-top:25px;letter-spacing:.1em}.skeleton{height:58px;background:linear-gradient(90deg,#0d0a13,#191322,#0d0a13);background-size:200%;animation:sh 1.2s infinite;border-top:1px solid #201929}@keyframes sh{to{background-position:-200%}}
@media(max-width:980px){.stats{grid-template-columns:repeat(3,1fr)}}@media(max-width:760px){.wrap{padding-top:20px}.stats{grid-template-columns:repeat(2,1fr)}.podium{grid-template-columns:1fr}.pod,.pod.first{min-height:125px}.pod.first{order:-1}.thead,.row{grid-template-columns:42px 1fr 112px;padding-left:13px;padding-right:13px}.steam{display:none}.hero{margin-top:42px}.hero h2{font-size:43px}.top{align-items:flex-start}.live{font-size:9px;padding:8px 9px}.sectionHead{align-items:center}}
</style></head>
<body><main class="wrap">
<header class="top"><div class="brand"><div class="mark">GF</div><div><h1>GUERRA FRIA</h1><p>RUST 2X • RANKING OFICIAL</p></div></div><div class="live"><span class="dot"></span><span id="updated">DADOS AO VIVO</span></div></header>
<section class="hero"><div class="eyebrow">Leaderboard do wipe</div><h2>QUEM DOMINA O <span>GUERRA FRIA?</span></h2><p>Combate, raid e farm registrados automaticamente durante o wipe. Escolha uma categoria e dispute seu lugar entre os melhores do servidor.</p></section>
<section class="stats"><div class="stat"><small>Jogadores ranqueados</small><strong id="sPlayers">—</strong></div><div class="stat"><small>Kills registradas</small><strong id="sKills">—</strong></div><div class="stat"><small>Farm registrado</small><strong id="sFarm">—</strong></div><div class="stat raid"><small>Ações de raid</small><strong id="sRaid">—</strong></div><div class="stat leader"><small>Líder de kills</small><strong id="sLeader">—</strong></div><div class="stat leader raid"><small>Líder de raid</small><strong id="sRaidLeader">—</strong></div></section>
<nav class="tabs" id="tabs"></nav><div class="sectionHead"><div><h3 id="sectionTitle">Top Kills</h3><p id="sectionSub">Os jogadores mais letais do wipe.</p></div><div class="metricBadge" id="metricBadge">Kills</div></div>
<section class="podium" id="podium"></section><section class="table"><div class="thead"><span>#</span><span>Jogador</span><span style="text-align:right" id="metricHead">Kills</span></div><div id="rows"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div></section>
<footer class="footer">GUERRA FRIA 2X • ESTATÍSTICAS OFICIAIS • ATUALIZAÇÃO AUTOMÁTICA</footer></main>
<script>
const meta={kills:{label:'Top Kills',metric:'Kills',sub:'Os jogadores mais letais do wipe.'},kd:{label:'K/D',metric:'K/D',sub:'Melhor relação entre kills e mortes — mínimo de 5 kills.'},hs:{label:'Top HS%',metric:'HS%',sub:'Precisão de headshots — mínimo de 10 kills.'},headshots:{label:'Headshots',metric:'HS',sub:'Maior quantidade total de headshots.'},raid:{label:'Top Raid',metric:'Raid',sub:'C4 usados + rockets disparados durante o wipe.'},c4:{label:'C4 Usados',metric:'C4',sub:'Quem mais utilizou C4 no wipe.'},rockets:{label:'Rockets',metric:'Rockets',sub:'Quem mais disparou rockets no wipe.'},wood:{label:'Madeira',metric:'Madeira',sub:'Quem mais farmou madeira no wipe.'},stone:{label:'Pedra',metric:'Pedra',sub:'Ranking de pedra coletada.'},metal:{label:'Metal',metric:'Metal',sub:'Minério de metal coletado.'},sulfur:{label:'Enxofre',metric:'Enxofre',sub:'Os maiores farmers de enxofre.'},scrap:{label:'Scrap',metric:'Scrap',sub:'Scrap registrado durante o wipe.'},gunpowder:{label:'Pólvora',metric:'Pólvora',sub:'Pólvora craftada pelos jogadores.'},explosives:{label:'Explosivos',metric:'Craft',sub:'Explosivos e munições de raid craftados.'},farm:{label:'Farm Total',metric:'Recursos',sub:'Soma dos principais recursos coletados.'},deaths:{label:'Mortes',metric:'Mortes',sub:'Quantidade total de mortes registradas.'}};
let data=null,current='kills';const fmt=n=>new Intl.NumberFormat('pt-BR',{maximumFractionDigits:2,notation:n>=1000000?'compact':'standard',compactDisplay:'short'}).format(n);const steamMasked=id=>id?id.slice(0,7)+'••••••'+id.slice(-4):'';
function esc(v){return String(v??'').replace(/[&<>'\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[c]))}
function suffix(v){return current==='hs'?v+'%':v}
function renderSummary(){const s=data?.summary||{};document.getElementById('sPlayers').textContent=fmt(s.activePlayers||0);document.getElementById('sKills').textContent=fmt(s.totalKills||0);document.getElementById('sFarm').textContent=fmt(s.totalFarm||0);document.getElementById('sRaid').textContent=fmt(s.totalRaid||0);document.getElementById('sLeader').textContent=s.leader||'—';document.getElementById('sRaidLeader').textContent=s.raidLeader||'—'}
function render(){const list=data?.categories?.[current]||[],m=meta[current];document.getElementById('metricHead').textContent=m.metric;document.getElementById('metricBadge').textContent=m.metric;document.getElementById('sectionTitle').textContent=m.label;document.getElementById('sectionSub').textContent=m.sub;document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x.dataset.k===current));const medals=['🥇','🥈','🥉'];document.getElementById('podium').innerHTML=[0,1,2].map(i=>{const p=list[i];if(!p)return '';const cls=i===0?'first':i===1?'second':'third';return '<article class="pod '+cls+'"><div class="rank">#'+(i+1)+' DO SERVIDOR</div><div class="medal">'+medals[i]+'</div><div class="name">'+esc(p.playerName)+'</div><div class="value">'+suffix(fmt(p.value))+'</div>'+(p.secondary?'<div class="podsub">'+esc(p.secondary)+'</div>':'')+'</article>'}).join('');const root=document.getElementById('rows');if(!list.length){root.innerHTML='<div class="empty">Ainda não há dados suficientes nesta categoria.</div>';return}root.innerHTML=list.map((p,i)=>'<div class="row '+(i<3?'toprow':'')+'"><div class="pos '+(i<3?'top':'')+'">#'+(i+1)+'</div><div class="player"><div class="pname">'+esc(p.playerName)+'</div><div class="steam">'+steamMasked(p.steamId)+'</div></div><div class="score">'+suffix(fmt(p.value))+(p.secondary?'<div class="sub">'+esc(p.secondary)+'</div>':'')+'</div></div>').join('')}
async function load(){try{const r=await fetch('/api/leaderboard',{cache:'no-store'});if(!r.ok)throw new Error();data=await r.json();renderSummary();render();const d=new Date(data.updatedAt);document.getElementById('updated').textContent='ATUALIZADO '+d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}catch{document.getElementById('rows').innerHTML='<div class="empty">Não foi possível carregar o ranking agora.</div>'}}
const tabs=document.getElementById('tabs');Object.entries(meta).forEach(([k,v])=>{const b=document.createElement('button');b.className='tab'+(k===current?' active':'');b.dataset.k=k;b.textContent=v.label;b.onclick=()=>{current=k;render()};tabs.appendChild(b)});load();setInterval(load,60000);
</script></body></html>`;

export default router;

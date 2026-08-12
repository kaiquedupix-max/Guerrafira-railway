import { Router, type IRouter } from "express";
import { db, playerStatsTable } from "@workspace/db";

const router: IRouter = Router();

type Row = typeof playerStatsTable.$inferSelect;

function num(v: unknown): number { return Number(v ?? 0) || 0; }
function publicPlayer(row: Row, value: number, secondary?: string) {
  return {
    steamId: row.steamId,
    playerName: row.playerName,
    value,
    secondary: secondary ?? null,
  };
}

router.get("/leaderboard", async (_req, res) => {
  try {
    const rows = await db.select().from(playerStatsTable);
    const top = (mapper: (r: Row) => number, filter?: (r: Row) => boolean) => rows
      .filter((r) => filter ? filter(r) : true)
      .map((r) => ({ row: r, value: mapper(r) }))
      .filter((x) => x.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 10)
      .map((x) => publicPlayer(x.row, x.value));

    const hs = rows
      .filter((r) => num(r.kills) >= 10)
      .map((r) => ({ row: r, value: num(r.kills) > 0 ? (num(r.headshots) / num(r.kills)) * 100 : 0 }))
      .sort((a, b) => b.value - a.value || num(b.row.kills) - num(a.row.kills))
      .slice(0, 10)
      .map((x) => publicPlayer(x.row, Number(x.value.toFixed(1)), `${num(x.row.headshots)} HS / ${num(x.row.kills)} kills`));

    const response = {
      updatedAt: new Date().toISOString(),
      categories: {
        kills: top((r) => num(r.kills)),
        hs,
        wood: top((r) => num(r.woodGathered)),
        stone: top((r) => num(r.stoneGathered)),
        metal: top((r) => num(r.metalOreGathered)),
        sulfur: top((r) => num(r.sulfurOreGathered)),
        scrap: top((r) => num(r.scrapGathered)),
        gunpowder: top((r) => num(r.gunpowderCrafted)),
        farm: top((r) => num(r.woodGathered) + num(r.stoneGathered) + num(r.metalOreGathered) + num(r.sulfurOreGathered) + num(r.scrapGathered)),
      },
    };
    res.json(response);
  } catch (error) {
    res.status(500).json({ error: "Falha ao carregar leaderboard" });
  }
});

export const leaderboardHtml = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="theme-color" content="#07090d" />
<title>Guerra Fria — Leaderboard</title>
<style>
:root{--bg:#07090d;--panel:#0e1219;--panel2:#121823;--line:#222b38;--text:#f4f7fb;--muted:#8d98a8;--accent:#ff3b30;--gold:#ffc83d;--silver:#b9c1cc;--bronze:#c9814a}
*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 50% -20%,#241016 0,#0a0d12 38%,var(--bg) 72%);color:var(--text);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;min-height:100vh}
.wrap{width:min(1180px,calc(100% - 28px));margin:auto;padding:38px 0 70px}.top{display:flex;align-items:center;justify-content:space-between;gap:18px;margin-bottom:32px}.brand{display:flex;align-items:center;gap:14px}.mark{width:46px;height:46px;border:1px solid #573039;background:linear-gradient(145deg,#291015,#100d11);display:grid;place-items:center;font-weight:900;color:#ff544b;box-shadow:0 0 30px #ff3b3014}.brand h1{font-size:19px;margin:0;letter-spacing:.16em}.brand p{margin:4px 0 0;color:var(--muted);font-size:12px;letter-spacing:.08em}.live{font-size:12px;color:#a9b4c2;display:flex;align-items:center;gap:8px}.dot{width:7px;height:7px;border-radius:50%;background:#42df88;box-shadow:0 0 12px #42df88}
.hero{text-align:center;margin:28px auto 30px;max-width:780px}.eyebrow{color:#ff5a50;font-size:11px;font-weight:800;letter-spacing:.24em;text-transform:uppercase}.hero h2{font-size:clamp(32px,6vw,66px);line-height:.95;margin:12px 0 14px;letter-spacing:-.045em}.hero h2 span{color:#ff4238}.hero p{color:var(--muted);font-size:14px;line-height:1.6;margin:0 auto;max-width:620px}
.tabs{display:flex;gap:8px;overflow:auto;padding:4px 2px 13px;margin:30px 0 24px;scrollbar-width:none}.tab{white-space:nowrap;border:1px solid var(--line);background:#0d1118;color:#98a3b3;border-radius:9px;padding:10px 14px;font-weight:700;font-size:12px;cursor:pointer;transition:.18s}.tab:hover{border-color:#3c4655;color:#fff}.tab.active{background:#211115;border-color:#663038;color:#ff5b52;box-shadow:inset 0 0 22px #ff3b300c}
.podium{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;align-items:end;margin-bottom:18px}.pod{border:1px solid var(--line);background:linear-gradient(180deg,#121720,#0b0f15);border-radius:14px;padding:22px 18px;position:relative;overflow:hidden;min-height:152px}.pod:after{content:"";position:absolute;inset:auto -40px -60px;height:110px;background:radial-gradient(circle,#ffffff0d,transparent 68%)}.pod.first{min-height:178px;border-color:#665324}.pod .rank{font-size:11px;font-weight:900;letter-spacing:.18em;color:var(--muted)}.pod .medal{font-size:25px;margin:10px 0 6px}.pod .name{font-size:17px;font-weight:850;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.pod .value{font-size:25px;font-weight:900;margin-top:8px;letter-spacing:-.03em}.pod.first .value{color:var(--gold)}.pod.second .value{color:var(--silver)}.pod.third .value{color:var(--bronze)}
.table{border:1px solid var(--line);background:#0b0f15;border-radius:14px;overflow:hidden}.thead,.row{display:grid;grid-template-columns:64px 1fr 150px;align-items:center;gap:14px}.thead{padding:13px 18px;background:#11161e;color:#697587;font-size:10px;text-transform:uppercase;font-weight:850;letter-spacing:.15em}.row{padding:15px 18px;border-top:1px solid #1a212b;transition:.15s}.row:hover{background:#10151d}.pos{font-size:13px;color:#788596;font-weight:800}.player{min-width:0}.pname{font-weight:760;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.steam{color:#667285;font-size:10px;margin-top:3px}.score{text-align:right;font-weight:900;font-size:16px}.sub{color:#758194;font-size:10px;font-weight:500;margin-top:2px}.empty{padding:55px;text-align:center;color:#748094}.footer{text-align:center;color:#515c6b;font-size:11px;margin-top:24px}.skeleton{height:58px;background:linear-gradient(90deg,#0d1218,#141b24,#0d1218);background-size:200%;animation:sh 1.2s infinite;border-top:1px solid #1a212b}@keyframes sh{to{background-position:-200%}}
@media(max-width:700px){.wrap{padding-top:22px}.top{align-items:flex-start}.live{font-size:10px}.podium{grid-template-columns:1fr}.pod,.pod.first{min-height:125px}.pod.first{order:-1}.thead,.row{grid-template-columns:42px 1fr 92px;padding-left:13px;padding-right:13px}.steam{display:none}.hero{margin-top:40px}.hero h2{font-size:42px}}
</style>
</head>
<body><main class="wrap">
<header class="top"><div class="brand"><div class="mark">GF</div><div><h1>GUERRA FRIA</h1><p>RUST 2X • LEADERBOARD</p></div></div><div class="live"><span class="dot"></span><span id="updated">DADOS AO VIVO</span></div></header>
<section class="hero"><div class="eyebrow">Ranking oficial</div><h2>DOMINE O <span>SERVIDOR.</span></h2><p>As estatísticas são registradas automaticamente durante o wipe. Escolha uma categoria e veja quem está no topo do Guerra Fria.</p></section>
<nav class="tabs" id="tabs"></nav><section class="podium" id="podium"></section><section class="table"><div class="thead"><span>#</span><span>Jogador</span><span style="text-align:right" id="metricHead">Pontos</span></div><div id="rows"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div></section>
<footer class="footer">GUERRA FRIA 2X • ESTATÍSTICAS OFICIAIS DO SERVIDOR</footer>
</main>
<script>
const meta={kills:['Top Kills','Kills','kills'],hs:['Top HS','HS%','%'],wood:['Madeira','Madeira',''],stone:['Pedra','Pedra',''],metal:['Metal','Minério de metal',''],sulfur:['Enxofre','Minério de enxofre',''],scrap:['Scrap','Scrap',''],gunpowder:['Pólvora','Pólvora craftada',''],farm:['Farm Total','Recursos','']};
let data=null,current='kills';const fmt=n=>new Intl.NumberFormat('pt-BR',{maximumFractionDigits:1}).format(n);
function steamMasked(id){return id? id.slice(0,7)+'••••••'+id.slice(-4):''}
function render(){const list=(data?.categories?.[current]||[]);document.getElementById('metricHead').textContent=meta[current][1];document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x.dataset.k===current));
const medals=['🥇','🥈','🥉'];document.getElementById('podium').innerHTML=[0,1,2].map((i)=>{const p=list[i];if(!p)return '';const cls=i===0?'first':i===1?'second':'third';return '<article class="pod '+cls+'"><div class="rank">#'+(i+1)+' DO SERVIDOR</div><div class="medal">'+medals[i]+'</div><div class="name">'+esc(p.playerName)+'</div><div class="value">'+fmt(p.value)+(current==='hs'?'%':'')+'</div></article>'}).join('');
const root=document.getElementById('rows');if(!list.length){root.innerHTML='<div class="empty">Ainda não há dados suficientes nesta categoria.</div>';return}root.innerHTML=list.map((p,i)=>'<div class="row"><div class="pos">#'+(i+1)+'</div><div class="player"><div class="pname">'+esc(p.playerName)+'</div><div class="steam">'+steamMasked(p.steamId)+'</div></div><div class="score">'+fmt(p.value)+(current==='hs'?'%':'')+(p.secondary?'<div class="sub">'+esc(p.secondary)+'</div>':'')+'</div></div>').join('')}
function esc(v){return String(v??'').replace(/[&<>'\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[c]))}
async function load(){try{const r=await fetch('/api/leaderboard',{cache:'no-store'});data=await r.json();render();const d=new Date(data.updatedAt);document.getElementById('updated').textContent='ATUALIZADO '+d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}catch{document.getElementById('rows').innerHTML='<div class="empty">Não foi possível carregar o ranking agora.</div>'}}
const tabs=document.getElementById('tabs');Object.entries(meta).forEach(([k,v])=>{const b=document.createElement('button');b.className='tab'+(k===current?' active':'');b.dataset.k=k;b.textContent=v[0];b.onclick=()=>{current=k;render()};tabs.appendChild(b)});load();setInterval(load,60000);
</script></body></html>`;

export default router;

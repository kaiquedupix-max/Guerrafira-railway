import { Router, type IRouter } from "express";
import { getServerInfo } from "../bot/utils/rcon.js";
import { getHostResourceSnapshot } from "../core/hostWipe.js";

const router: IRouter = Router();

function wipeWindow(now = new Date()) {
  const tz = "America/Sao_Paulo";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year:"numeric", month:"2-digit", day:"2-digit", weekday:"short", hour:"2-digit", minute:"2-digit", hour12:false }).formatToParts(now);
  const get = (t:string) => parts.find(p=>p.type===t)?.value || "";
  const local = new Date(`${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:00-03:00`);
  const candidates: Date[] = [];
  for (let d=-7; d<=7; d++) {
    const x = new Date(local.getTime() + d*86400000);
    const day = x.getDay();
    if (day===1 || day===5) { x.setHours(18,30,0,0); candidates.push(x); }
  }
  const last = [...candidates].filter(x=>x<=local).sort((a,b)=>b.getTime()-a.getTime())[0];
  const next = [...candidates].filter(x=>x>local).sort((a,b)=>a.getTime()-b.getTime())[0];
  return { last: last?.toISOString() || null, next: next?.toISOString() || null };
}

router.get("/status/data", async (_req, res) => {
  const [info, host] = await Promise.all([
    getServerInfo().catch(()=>null),
    getHostResourceSnapshot().catch(()=>null),
  ]);
  const wipe = wipeWindow();
  const online = host ? host.state === "running" : Boolean(info);
  res.setHeader("Cache-Control","no-store");
  res.json({
    online,
    state: host?.state || (info ? "running" : "unknown"),
    hostname: info?.hostname || "Guerra Fria 2X • Duo",
    players: info?.players ?? 0,
    maxPlayers: info?.maxPlayers ?? 0,
    queued: info?.queued ?? 0,
    joining: info?.joining ?? 0,
    sleepers: info?.sleepers ?? 0,
    map: info?.map || "—",
    gameTime: info?.gameTime || "—",
    uptimeMs: host?.uptime ?? 0,
    lastWipe: wipe.last,
    nextWipe: wipe.next,
    updatedAt: new Date().toISOString(),
  });
});

router.get("/status", (_req, res) => {
  res.setHeader("Cache-Control","no-store");
  res.type("html").send(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#050708"><title>Guerra Fria • Status</title><style>
:root{--bg:#050708;--panel:#0b0f11;--line:#20262a;--muted:#737b80;--text:#f3f2ee;--orange:#f59d0a;--green:#38cf7a;--red:#ef4444}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:Arial,Helvetica,sans-serif}.wrap{width:min(980px,calc(100% - 28px));margin:auto}.top{height:58px;border-bottom:1px solid #171b1e;background:#07090a;position:sticky;top:0;z-index:20}.nav{height:100%;display:grid;grid-template-columns:1fr auto 1fr;align-items:center}.brand{display:flex;align-items:center;gap:9px;text-decoration:none;font-size:8px;letter-spacing:.16em;font-weight:950}.brand i{width:25px;height:25px;background:var(--orange);color:#070809;display:grid;place-items:center;font-style:normal;font-size:8px}.menu{display:flex;gap:4px}.menu a{height:31px;padding:0 10px;display:grid;place-items:center;text-decoration:none;border:1px solid transparent;color:#777f84;font-size:7px;font-weight:950;letter-spacing:.12em}.menu a.active{color:#fff;border-color:#a66a12;background:#0b0e10}.hero{padding:72px 0 34px;text-align:center}.ey{display:inline-flex;align-items:center;gap:7px;color:#60d792;border:1px solid #173c2a;background:#07150f;padding:6px 9px;font-size:7px;letter-spacing:.14em;font-weight:950}.dot{width:6px;height:6px;border-radius:50%;background:var(--green)}h1{font-family:Impact,"Arial Narrow",Arial,sans-serif;font-size:clamp(42px,6vw,66px);line-height:.9;margin:18px 0 10px;text-transform:uppercase}h1 em{font-style:normal;color:var(--orange)}.hero p{color:var(--muted);font-size:10px}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.card{border:1px solid var(--line);background:var(--panel);padding:18px;min-height:130px}.card .ico{font-size:18px}.card small{display:block;color:#646c72;font-size:7px;letter-spacing:.12em;margin:10px 0 6px}.card strong{font-size:18px}.wide{grid-column:span 2}.section{padding:38px 0 70px}.timeline{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px}.wipe{border:1px solid var(--line);background:var(--panel);padding:20px}.wipe small{color:#686f75;font-size:7px;letter-spacing:.12em}.wipe b{display:block;font-size:18px;margin-top:8px}.wipe.next{border-color:#6a4617}.wipe.next b{color:var(--orange)}.bar{height:7px;background:#151a1e;margin-top:12px;overflow:hidden}.bar span{display:block;height:100%;background:var(--orange);width:0}.meta{margin-top:10px;color:#6d757a;font-size:8px}.footer{text-align:center;color:#4f565b;font-size:7px;padding:28px 0 42px;border-top:1px solid #171b1e}@media(max-width:720px){.wrap{width:calc(100% - 20px)}.top{height:52px}.nav{grid-template-columns:auto 1fr}.brand span{display:none}.menu{justify-self:end}.menu a{font-size:6px;padding:0 5px}.hero{padding:54px 0 28px}.grid{grid-template-columns:1fr 1fr}.wide{grid-column:span 2}.timeline{grid-template-columns:1fr}.card{min-height:110px;padding:15px}}
</style></head><body><header class="top"><div class="wrap nav"><a class="brand" href="/"><i>GF</i><span>GUERRA FRIA</span></a><nav class="menu"><a href="/">INÍCIO</a><a href="/loja">LOJA</a><a href="/leaderboard">LEADERBOARD</a><a href="/season1">SEASON</a><a class="active" href="/api/status">STATUS</a></nav></div></header><main class="wrap"><section class="hero"><div class="ey"><span class="dot" id="dot"></span><span id="state">CARREGANDO STATUS</span></div><h1>STATUS DO <em>SERVIDOR</em></h1><p>Dados em tempo real do Guerra Fria 2X • Duo.</p></section><section class="grid"><div class="card"><div class="ico">👥</div><small>JOGADORES</small><strong id="players">—</strong></div><div class="card"><div class="ico">🎟️</div><small>SLOTS</small><strong id="slots">—</strong></div><div class="card"><div class="ico">⏳</div><small>FILA</small><strong id="queue">—</strong></div><div class="card"><div class="ico">🛏️</div><small>SLEEPERS</small><strong id="sleepers">—</strong></div><div class="card wide"><div class="ico">🗺️</div><small>MAPA ATUAL</small><strong id="map">—</strong></div><div class="card wide"><div class="ico">⏱️</div><small>UPTIME</small><strong id="uptime">—</strong><div class="meta" id="updated">Atualizando...</div></div></section><section class="section"><div class="timeline"><div class="wipe"><small>ÚLTIMO WIPE</small><b id="lastWipe">—</b><div class="meta">Wipes: segunda e sexta • 18:30</div></div><div class="wipe next"><small>PRÓXIMO WIPE</small><b id="nextWipe">—</b><div class="meta" id="countdown">Calculando...</div></div></div><div class="bar"><span id="fill"></span></div></section></main><footer class="footer">© 2026 GUERRA FRIA • STATUS OFICIAL</footer><script>
const fmtDate=v=>v?new Date(v).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',weekday:'long',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'—';const up=ms=>{let s=Math.floor(ms/1000),d=Math.floor(s/86400);s%=86400;let h=Math.floor(s/3600);let m=Math.floor((s%3600)/60);return(d?d+'d ':'')+h+'h '+m+'min'};let last=null;function tick(){if(!last?.nextWipe)return;const n=new Date(last.nextWipe).getTime()-Date.now();if(n<=0){document.getElementById('countdown').textContent='Wipe em andamento';return}const d=Math.floor(n/86400000),h=Math.floor(n%86400000/3600000),m=Math.floor(n%3600000/60000);document.getElementById('countdown').textContent='Faltam '+(d?d+'d ':'')+h+'h '+m+'min';const a=new Date(last.lastWipe).getTime(),b=new Date(last.nextWipe).getTime();document.getElementById('fill').style.width=Math.max(0,Math.min(100,(Date.now()-a)/(b-a)*100))+'%'}async function load(){try{const r=await fetch('/api/status/data',{cache:'no-store'}),d=await r.json();last=d;document.getElementById('state').textContent=d.online?'SERVIDOR ONLINE':'SERVIDOR OFFLINE';document.getElementById('dot').style.background=d.online?'#38cf7a':'#ef4444';document.getElementById('players').textContent=d.players;document.getElementById('slots').textContent=d.maxPlayers;document.getElementById('queue').textContent=d.queued;document.getElementById('sleepers').textContent=d.sleepers;document.getElementById('map').textContent=d.map;document.getElementById('uptime').textContent=up(d.uptimeMs);document.getElementById('lastWipe').textContent=fmtDate(d.lastWipe);document.getElementById('nextWipe').textContent=fmtDate(d.nextWipe);document.getElementById('updated').textContent='Atualizado '+new Date(d.updatedAt).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit',second:'2-digit'});tick()}catch{document.getElementById('state').textContent='STATUS INDISPONÍVEL'}}load();setInterval(load,30000);setInterval(tick,30000);
</script></body></html>`);
});

export default router;

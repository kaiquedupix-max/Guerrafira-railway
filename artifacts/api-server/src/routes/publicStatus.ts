import { Router, type IRouter } from "express";
import { executeRconCommand, getServerInfo } from "../bot/utils/rcon.js";
import { getHostResourceSnapshot } from "../core/hostWipe.js";

const router: IRouter = Router();

type LiveEvent = {
  id: string;
  name: string;
  icon: string;
  active?: boolean;
  lastAt?: string | null;
  nextAt?: string | null;
  detail?: string | null;
};

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

function validIso(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

async function readVerifiedEvents(): Promise<LiveEvent[]> {
  const raw = await executeRconCommand("gf.events").catch(()=>null);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    const source = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.events) ? parsed.events : [];
    const allowed: Record<string,{name:string;icon:string}> = {
      heli:{name:"Patrol Helicopter",icon:"🚁"},
      chinook:{name:"Chinook / CH47",icon:"🚁"},
      cargo:{name:"Cargo Ship",icon:"🚢"},
      airdrop:{name:"AirDrop",icon:"📦"},
      oil:{name:"Oil Rig",icon:"🛢️"},
    };
    const out: LiveEvent[] = [];
    for (const item of source) {
      const id = String(item?.id || item?.type || "").toLowerCase();
      const meta = allowed[id];
      if (!meta) continue;
      const lastAt = validIso(item?.lastAt ?? item?.last_at);
      const nextAt = validIso(item?.nextAt ?? item?.next_at);
      const active = item?.active === true;
      const detail = typeof item?.detail === "string" ? item.detail.slice(0,120) : null;
      if (!active && !lastAt && !nextAt && !detail) continue;
      out.push({ id, name:meta.name, icon:meta.icon, active, lastAt, nextAt, detail });
    }
    return out;
  } catch {
    return [];
  }
}

router.get("/status/data", async (_req, res) => {
  const [info, host, events] = await Promise.all([
    getServerInfo().catch(()=>null),
    getHostResourceSnapshot().catch(()=>null),
    readVerifiedEvents(),
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
    events,
    updatedAt: new Date().toISOString(),
  });
});

router.get("/status", (_req, res) => {
  res.setHeader("Cache-Control","no-store");
  res.type("html").send(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#050708"><title>Guerra Fria • Status</title><style>
:root{--bg:#050708;--panel:#0b0f11;--line:#20262a;--muted:#737b80;--text:#f3f2ee;--orange:#f59d0a;--green:#38cf7a;--red:#ef4444}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:Arial,Helvetica,sans-serif}.wrap{width:min(980px,calc(100% - 28px));margin:auto}.top{height:58px;border-bottom:1px solid #171b1e;background:#07090a;position:sticky;top:0;z-index:20}.nav{height:100%;display:grid;grid-template-columns:1fr auto 1fr;align-items:center}.brand{display:flex;align-items:center;gap:9px;text-decoration:none;font-size:8px;letter-spacing:.16em;font-weight:950}.brand i{width:25px;height:25px;background:var(--orange);color:#070809;display:grid;place-items:center;font-style:normal;font-size:8px}.menu{display:flex;gap:4px}.menu a{height:31px;padding:0 10px;display:grid;place-items:center;text-decoration:none;border:1px solid transparent;color:#777f84;font-size:7px;font-weight:950;letter-spacing:.12em}.menu a.active{color:#fff;border-color:#a66a12;background:#0b0e10}.hero{padding:72px 0 34px;text-align:center}.ey{display:inline-flex;align-items:center;gap:7px;color:#60d792;border:1px solid #173c2a;background:#07150f;padding:6px 9px;font-size:7px;letter-spacing:.14em;font-weight:950}.dot{width:6px;height:6px;border-radius:50%;background:var(--green)}h1,h2{font-family:Impact,"Arial Narrow",Arial,sans-serif;text-transform:uppercase}h1{font-size:clamp(42px,6vw,66px);line-height:.9;margin:18px 0 10px}h1 em,h2 em{font-style:normal;color:var(--orange)}.hero p{color:var(--muted);font-size:10px}.population{border:1px solid #252b2f;background:#0b0f11;padding:18px 20px;margin:0 0 14px}.populationTop{display:flex;align-items:center;justify-content:space-between;gap:16px}.populationLabel{display:flex;align-items:center;gap:9px;font-size:8px;font-weight:950;letter-spacing:.12em}.populationLabel .pulse{width:7px;height:7px;border-radius:50%;background:var(--green);box-shadow:0 0 0 0 rgba(56,207,122,.5);animation:pulse 1.8s infinite}.populationNumbers{display:flex;align-items:baseline;gap:5px;font-family:Impact,"Arial Narrow",Arial,sans-serif}.populationNumbers strong{font-size:26px;color:#fff}.populationNumbers span{font-size:13px;color:#697178}.populationTrack{height:10px;background:#151a1e;margin-top:13px;overflow:hidden;position:relative}.populationFill{height:100%;width:0;background:linear-gradient(90deg,#d78100,#f59d0a);transition:width .9s cubic-bezier(.2,.8,.2,1)}.populationMeta{display:flex;justify-content:space-between;gap:12px;margin-top:8px;color:#626a70;font-size:7px;letter-spacing:.08em}.populationMeta b{color:#d7dad7}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.card{border:1px solid var(--line);background:var(--panel);padding:18px;min-height:130px}.card .ico{font-size:18px}.card small{display:block;color:#646c72;font-size:7px;letter-spacing:.12em;margin:10px 0 6px}.card strong{font-size:18px}.wide{grid-column:span 2}.section{padding:38px 0 70px}.timeline{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px}.wipe{border:1px solid var(--line);background:var(--panel);padding:20px}.wipe small{color:#686f75;font-size:7px;letter-spacing:.12em}.wipe b{display:block;font-size:18px;margin-top:8px}.wipe.next{border-color:#6a4617}.wipe.next b{color:var(--orange)}.bar{height:7px;background:#151a1e;margin-top:12px;overflow:hidden}.bar span{display:block;height:100%;background:var(--orange);width:0}.meta{margin-top:10px;color:#6d757a;font-size:8px}.eventsSection{display:none;padding:8px 0 70px}.eventsHead{text-align:center;margin-bottom:22px}.eventsHead h2{font-size:clamp(30px,4vw,44px);margin:0}.eventsHead p{color:#727a80;font-size:9px;margin:9px auto 0;max-width:560px;line-height:1.6}.eventsGrid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}.eventCard{border:1px solid var(--line);background:var(--panel);padding:18px;display:grid;grid-template-columns:42px 1fr;gap:13px;align-items:start}.eventIcon{width:42px;height:42px;border:1px solid #2b3237;background:#0f1315;display:grid;place-items:center;font-size:20px}.eventCard.active{border-color:#1f6e49;background:#0a1510}.eventCard .tag{display:inline-flex;width:max-content;padding:4px 6px;border:1px solid #31383c;color:#7f888e;font-size:6px;letter-spacing:.12em;font-weight:950}.eventCard.active .tag{border-color:#216b4a;color:#5ee4a0}.eventCard h3{font-size:12px;margin:8px 0 7px}.eventRows{display:grid;gap:5px}.eventRows div{font-size:8px;color:#747d83}.eventRows b{color:#dfe4e1;font-weight:850}.footer{text-align:center;color:#4f565b;font-size:7px;padding:28px 0 42px;border-top:1px solid #171b1e}@keyframes pulse{0%{box-shadow:0 0 0 0 rgba(56,207,122,.45)}70%{box-shadow:0 0 0 8px rgba(56,207,122,0)}100%{box-shadow:0 0 0 0 rgba(56,207,122,0)}}@media(max-width:720px){.wrap{width:calc(100% - 20px)}.top{height:52px}.nav{grid-template-columns:auto 1fr}.brand span{display:none}.menu{justify-self:end}.menu a{font-size:6px;padding:0 5px}.hero{padding:54px 0 28px}.population{padding:15px}.populationNumbers strong{font-size:22px}.populationMeta{font-size:6.5px}.grid{grid-template-columns:1fr 1fr}.wide{grid-column:span 2}.timeline,.eventsGrid{grid-template-columns:1fr}.card{min-height:110px;padding:15px}}
</style></head><body><header class="top"><div class="wrap nav"><a class="brand" href="/"><i>GF</i><span>GUERRA FRIA</span></a><nav class="menu"><a href="/">INÍCIO</a><a href="/loja">LOJA</a><a href="/leaderboard">LEADERBOARD</a><a href="/season1">SEASON</a><a class="active" href="/api/status">STATUS</a></nav></div></header><main class="wrap"><section class="hero"><div class="ey"><span class="dot" id="dot"></span><span id="state">CARREGANDO STATUS</span></div><h1>STATUS DO <em>SERVIDOR</em></h1><p>Dados em tempo real do Guerra Fria 2X • Duo.</p></section><section class="population"><div class="populationTop"><div class="populationLabel"><span class="pulse" id="popPulse"></span><span>JOGADORES ONLINE</span></div><div class="populationNumbers"><strong id="popPlayers">—</strong><span>/</span><span id="popSlots">—</span></div></div><div class="populationTrack"><div class="populationFill" id="populationFill"></div></div><div class="populationMeta"><span id="populationPct">OCUPAÇÃO —</span><span><b id="populationFree">—</b> SLOTS LIVRES</span></div></section><section class="grid"><div class="card"><div class="ico">👥</div><small>JOGADORES</small><strong id="players">—</strong></div><div class="card"><div class="ico">🎟️</div><small>SLOTS</small><strong id="slots">—</strong></div><div class="card"><div class="ico">⏳</div><small>FILA</small><strong id="queue">—</strong></div><div class="card"><div class="ico">🛏️</div><small>SLEEPERS</small><strong id="sleepers">—</strong></div><div class="card wide"><div class="ico">🗺️</div><small>MAPA ATUAL</small><strong id="map">—</strong></div><div class="card wide"><div class="ico">⏱️</div><small>UPTIME</small><strong id="uptime">—</strong><div class="meta" id="updated">Atualizando...</div></div></section><section class="section"><div class="timeline"><div class="wipe"><small>ÚLTIMO WIPE</small><b id="lastWipe">—</b><div class="meta">Wipes: segunda e sexta • 18:30</div></div><div class="wipe next"><small>PRÓXIMO WIPE</small><b id="nextWipe">—</b><div class="meta" id="countdown">Calculando...</div></div></div><div class="bar"><span id="fill"></span></div></section><section class="eventsSection" id="eventsSection"><div class="eventsHead"><h2>EVENTOS <em>AO VIVO</em></h2><p>Esta área aparece somente quando o próprio servidor fornece telemetria confirmada. Nenhum horário é estimado.</p></div><div class="eventsGrid" id="eventsGrid"></div></section></main><footer class="footer">© 2026 GUERRA FRIA • STATUS OFICIAL</footer><script>
const fmtDate=v=>v?new Date(v).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):null;const up=ms=>{let s=Math.floor(ms/1000),d=Math.floor(s/86400);s%=86400;let h=Math.floor(s/3600);let m=Math.floor((s%3600)/60);return(d?d+'d ':'')+h+'h '+m+'min'};let last=null;function tick(){if(!last?.nextWipe)return;const n=new Date(last.nextWipe).getTime()-Date.now();if(n<=0){document.getElementById('countdown').textContent='Wipe em andamento';return}const d=Math.floor(n/86400000),h=Math.floor(n%86400000/3600000),m=Math.floor(n%3600000/60000);document.getElementById('countdown').textContent='Faltam '+(d?d+'d ':'')+h+'h '+m+'min';const a=new Date(last.lastWipe).getTime(),b=new Date(last.nextWipe).getTime();document.getElementById('fill').style.width=Math.max(0,Math.min(100,(Date.now()-a)/(b-a)*100))+'%'}function renderEvents(events){const section=document.getElementById('eventsSection'),grid=document.getElementById('eventsGrid');grid.innerHTML='';if(!Array.isArray(events)||!events.length){section.style.display='none';return}for(const e of events){const lastAt=fmtDate(e.lastAt),nextAt=fmtDate(e.nextAt);const rows=[];if(e.active)rows.push('<div><b>Status:</b> ativo agora</div>');if(lastAt)rows.push('<div><b>Última ocorrência:</b> '+lastAt+'</div>');if(nextAt)rows.push('<div><b>Próximo:</b> '+nextAt+'</div>');if(e.detail)rows.push('<div><b>Informação:</b> '+String(e.detail).replace(/[<>]/g,'')+'</div>');if(!rows.length)continue;const card=document.createElement('article');card.className='eventCard'+(e.active?' active':'');card.innerHTML='<div class="eventIcon">'+e.icon+'</div><div><span class="tag">'+(e.active?'ATIVO AGORA':'DADO CONFIRMADO')+'</span><h3>'+e.name+'</h3><div class="eventRows">'+rows.join('')+'</div></div>';grid.appendChild(card)}section.style.display=grid.children.length?'block':'none'}function renderPopulation(d){const players=Math.max(0,Number(d.players)||0),slots=Math.max(0,Number(d.maxPlayers)||0),pct=slots>0?Math.min(100,players/slots*100):0,free=Math.max(0,slots-players);document.getElementById('popPlayers').textContent=players;document.getElementById('popSlots').textContent=slots||'—';document.getElementById('populationFill').style.width=pct+'%';document.getElementById('populationPct').textContent=slots>0?'OCUPAÇÃO '+Math.round(pct)+'%':'OCUPAÇÃO —';document.getElementById('populationFree').textContent=slots>0?free:'—';document.getElementById('popPulse').style.background=d.online?'#38cf7a':'#ef4444'}async function load(){try{const r=await fetch('/api/status/data',{cache:'no-store'}),d=await r.json();last=d;document.getElementById('state').textContent=d.online?'SERVIDOR ONLINE':'SERVIDOR OFFLINE';document.getElementById('dot').style.background=d.online?'#38cf7a':'#ef4444';document.getElementById('players').textContent=d.players;document.getElementById('slots').textContent=d.maxPlayers;document.getElementById('queue').textContent=d.queued;document.getElementById('sleepers').textContent=d.sleepers;document.getElementById('map').textContent=d.map;document.getElementById('uptime').textContent=up(d.uptimeMs);document.getElementById('lastWipe').textContent=fmtDate(d.lastWipe)||'—';document.getElementById('nextWipe').textContent=fmtDate(d.nextWipe)||'—';document.getElementById('updated').textContent='Atualizado '+new Date(d.updatedAt).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit',second:'2-digit'});renderPopulation(d);renderEvents(d.events);tick()}catch{document.getElementById('state').textContent='STATUS INDISPONÍVEL';document.getElementById('eventsSection').style.display='none'}}load();setInterval(load,30000);setInterval(tick,30000);
</script></body></html>`);
});

export default router;
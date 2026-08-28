export function renderSeasonPage(seasonNumber: number): string {
  const n = Math.max(1, Math.trunc(Number(seasonNumber) || 1));
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#08090b">
<title>Season ${n} • Guerra Fria Rust</title>
<style>
:root{--bg:#08090b;--panel:#101216;--panel2:#15181e;--line:#2a2f38;--text:#f5f5f4;--muted:#9298a3;--red:#ef4444;--red2:#7f1d1d;--gold:#f59e0b;--green:#22c55e;--cyan:#22d3ee}
*{box-sizing:border-box}html{background:var(--bg);scroll-behavior:smooth}body{margin:0;color:var(--text);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:radial-gradient(circle at 50% -10%,#35130f 0,#171012 22%,#0b0d11 48%,#08090b 100%);min-height:100vh}a{color:inherit}.wrap{width:min(1180px,calc(100% - 24px));margin:auto}.top{height:70px;position:sticky;top:0;z-index:40;background:#08090be8;backdrop-filter:blur(16px);border-bottom:1px solid #ffffff0d}.top .wrap{height:100%;display:flex;align-items:center;justify-content:space-between;gap:10px}.brand{display:flex;align-items:center;gap:10px;font-weight:950;letter-spacing:.05em}.mark{width:38px;height:38px;border-radius:10px;display:grid;place-items:center;background:linear-gradient(135deg,#ef4444,#7f1d1d);font-size:11px;border:1px solid #ff6b6b44}.nav{display:flex;gap:5px}.nav a{text-decoration:none;color:var(--muted);font-size:11px;font-weight:850;padding:9px 10px;border-radius:9px}.nav a:hover,.nav .on{background:#ffffff0a;color:white}.hero{text-align:center;padding:54px 0 26px}.ey{color:#fca5a5;font-size:10px;font-weight:950;letter-spacing:.2em;text-transform:uppercase}.hero h1{margin:9px 0 8px;font-size:clamp(46px,9vw,84px);letter-spacing:-.055em;line-height:.92}.hero h1 span{color:var(--red)}.hero p{max-width:790px;margin:16px auto 0;color:var(--muted);font-size:14px;line-height:1.65}.status{margin:18px auto 0;display:inline-flex;gap:8px;align-items:center;border:1px solid var(--line);background:#0a0c10e6;border-radius:999px;padding:9px 14px;font-size:11px;color:#d1d5db}.dot{width:8px;height:8px;border-radius:50%;background:var(--green);box-shadow:0 0 11px currentColor}.explain{display:grid;grid-template-columns:1.3fr .7fr;gap:12px;margin:12px 0 24px}.callout{border:1px solid var(--line);background:linear-gradient(180deg,#11141a,#0b0d11);border-radius:17px;padding:18px}.callout h2{margin:0 0 7px;font-size:15px}.callout p{margin:0;color:#b1b7c1;font-size:12px;line-height:1.6}.callout strong{color:white}.guide{display:flex;flex-direction:column;justify-content:space-between;border-color:#7f1d1d;background:linear-gradient(145deg,#261012,#111318)}.guide a{margin-top:14px;display:inline-flex;justify-content:center;text-decoration:none;background:#ef4444;color:white;border-radius:10px;padding:10px 12px;font-size:11px;font-weight:950}.ranks{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin:0 0 25px}.rankCard{border:1px solid var(--line);background:#0d1014;border-radius:14px;padding:13px 8px;text-align:center;position:relative;overflow:hidden}.rankCard .ico{font-size:25px}.rankCard b{display:block;font-size:12px;margin-top:4px}.rankCard span{display:block;color:var(--muted);font-size:9px;margin-top:2px}.rankCard.max{border-color:#a1620766;background:linear-gradient(180deg,#2b200b,#111318)}.rankCard.max:after{content:"MÁXIMA";position:absolute;right:-24px;top:8px;transform:rotate(35deg);font-size:7px;font-weight:950;background:#f59e0b;color:#111827;padding:3px 28px}.sectionTitle{display:flex;align-items:end;justify-content:space-between;gap:10px;margin:18px 0 10px}.sectionTitle h2{margin:0;font-size:17px}.sectionTitle p{margin:0;color:var(--muted);font-size:10px}.generals{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:26px}.general{border:1px solid #a162075c;background:linear-gradient(180deg,#211906,#101216);border-radius:16px;padding:16px;display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:12px;cursor:pointer}.general .pos{font-size:21px;font-weight:950;color:#fbbf24}.general .name{font-size:13px;font-weight:950;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.general .sub{font-size:9px;color:#a8a29e;margin-top:2px}.general .score{text-align:right}.general .score b{display:block;font-size:18px}.general .score span{font-size:8px;color:#a8a29e;text-transform:uppercase;letter-spacing:.08em}.noGeneral{grid-column:1/-1;border:1px dashed var(--line);border-radius:15px;padding:22px;text-align:center;color:var(--muted);font-size:12px}.card{border:1px solid var(--line);background:#0b0d11e8;border-radius:18px;overflow:hidden;margin-bottom:42px;box-shadow:0 25px 80px #0005}.head{padding:16px 18px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line)}.head h2{font-size:15px;margin:0}.small{font-size:10px;color:var(--muted)}.tableWrap{overflow:auto}.loading{padding:58px 20px;text-align:center;color:var(--muted)}table{width:100%;border-collapse:collapse;min-width:960px}th{padding:11px 12px;text-align:left;font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:#737d90;background:#0b0d11}td{padding:12px;border-top:1px solid #ffffff0a;font-size:12px;vertical-align:middle}.rankRow{cursor:pointer}.rankRow:hover td{background:#ef444407}.position{color:#818b9f;font-weight:950;width:45px}.player{font-weight:900}.steam{font-size:9px;color:#596275;margin-top:2px}.patent{display:inline-flex;align-items:center;gap:5px;border:1px solid #343944;background:#12151a;border-radius:999px;padding:5px 8px;font-size:9px;font-weight:950}.patent.generalP{border-color:#a1620770;background:#2a1d08;color:#fde68a}.gscore{font-weight:950;color:#fde68a}.dash{color:#4b5563}.actions{display:flex;gap:4px;flex-wrap:wrap;max-width:360px}.action{border:1px solid #2f3540;background:#11141a;border-radius:999px;padding:4px 6px;font-size:8px;color:#c7ccd4;white-space:nowrap}.num{font-variant-numeric:tabular-nums}.footer{text-align:center;color:#596275;font-size:10px;padding:5px 0 42px}.modalBack{display:none;position:fixed;inset:0;z-index:100;background:#000c;backdrop-filter:blur(9px);padding:10px;overflow:auto}.modalBack.open{display:block}.modal{width:min(900px,100%);margin:18px auto;background:#0b0d11;border:1px solid #343943;border-radius:20px;overflow:hidden;box-shadow:0 30px 120px #000}.modalTop{display:flex;justify-content:space-between;gap:12px;padding:18px;border-bottom:1px solid var(--line);background:linear-gradient(180deg,#17191f,#0e1014)}.modalName{font-size:22px;font-weight:950}.modalMeta{font-size:10px;color:var(--muted);margin-top:4px}.close{border:1px solid var(--line);background:#15181e;color:white;border-radius:10px;width:38px;height:38px;font-size:20px;cursor:pointer}.auditIntro{padding:14px 18px;background:#0e1014;border-bottom:1px solid var(--line);font-size:11px;color:#aab0ba;line-height:1.55}.auditIntro strong{color:white}.auditGrid{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;padding:14px 18px}.auditStat{border:1px solid var(--line);background:#11141a;border-radius:12px;padding:11px}.auditStat b{display:block;font-size:17px}.auditStat span{font-size:8px;color:var(--muted);text-transform:uppercase}.txList{padding:4px 18px 16px}.tx{display:grid;grid-template-columns:110px 145px 1fr auto;gap:10px;align-items:center;border-bottom:1px solid #ffffff09;padding:11px 2px}.tx .cat{font-size:8px;color:var(--muted);text-transform:uppercase}.tx .type{font-size:10px;font-weight:900}.tx .details{font-size:10px;color:#aab0ba}.tx .dir{font-size:9px;font-weight:950;border-radius:999px;padding:5px 7px}.gain{color:#86efac;background:#14532d44}.loss{color:#fca5a5;background:#7f1d1d44}.neutral{color:#d1d5db;background:#37415155}.emptyAudit{padding:30px;text-align:center;color:var(--muted);font-size:11px}
@media(max-width:780px){.nav a:first-child{display:none}.explain{grid-template-columns:1fr}.ranks{grid-template-columns:repeat(2,1fr)}.rankCard.max{grid-column:1/-1}.generals{grid-template-columns:1fr}.hero{padding-top:38px}.auditGrid{grid-template-columns:repeat(2,1fr)}.auditGrid .auditStat:last-child{grid-column:1/-1}.tx{grid-template-columns:1fr auto}.tx .details{grid-column:1/-1}.modal{margin:5px auto}.modalBack{padding:5px}}
</style>
</head>
<body>
<header class="top"><div class="wrap"><div class="brand"><div class="mark">GF</div><div>GUERRA FRIA</div></div><nav class="nav"><a href="/">Início</a><a href="/leaderboard">Leaderboard</a><a class="on" href="/season${n}">Season ${n}</a><a href="/season${n}/guia">Como funciona</a></nav></div></header>
<main class="wrap">
<section class="hero"><div class="ey">Guerra Fria • Season Premiada</div><h1>SEASON <span>${n}</span></h1><p>A classificação agora é apresentada por <strong>patentes</strong>. O MMR continua sendo o motor interno da Season, mas não é exibido para jogadores comuns. A patente máxima, <strong>General de Guerra</strong>, possui uma pontuação comparativa própria para deixar claro quem lidera entre os Generais.</p><div class="status"><span class="dot" id="dot"></span><span id="status">Carregando classificação...</span></div></section>

<section class="explain"><div class="callout"><h2>🎖️ Patentes contabilizadas por MMR</h2><p>O servidor registra ações válidas de PvP, raid, farm, construção e eventos. Essas ações alimentam o <strong>MMR interno</strong>, que define a patente de cada jogador. O valor exato do MMR e o valor de cada ação ficam ocultos para evitar transformar a Season em uma tabela de farm de pontos.</p></div><div class="callout guide"><div><h2>📖 Entenda a Season</h2><p>Veja quais ações podem contar, como funcionam as patentes e por que a pontuação individual é protegida.</p></div><a href="/season${n}/guia">ABRIR GUIA DA SEASON</a></div></section>

<section class="ranks"><div class="rankCard"><div class="ico">🪖</div><b>Recruta</b><span>Patente inicial</span></div><div class="rankCard"><div class="ico">🎖️</div><b>Soldado</b><span>Em progressão</span></div><div class="rankCard"><div class="ico">⭐</div><b>Capitão</b><span>Patente intermediária</span></div><div class="rankCard"><div class="ico">🌟</div><b>Coronel</b><span>Alta patente</span></div><div class="rankCard max"><div class="ico">🏅</div><b>General de Guerra</b><span>Elite da Season</span></div></section>

<div class="sectionTitle"><div><h2>Conselho dos Generais</h2><p>Somente Generais de Guerra exibem pontuação comparativa.</p></div><div class="small" id="generalCount">—</div></div>
<section class="generals" id="generals"><div class="noGeneral">Carregando Generais...</div></section>

<section class="card"><div class="head"><h2>Classificação por Patentes</h2><span class="small" id="updated">Atualizando...</span></div><div class="tableWrap"><div class="loading" id="loading">Buscando dados da Season...</div><table id="table" hidden><thead><tr><th>#</th><th>Jogador</th><th>Patente</th><th>Pontuação de General</th><th>Ações que contaram</th><th>K</th><th>D</th><th>HS</th><th>Raids</th><th>Eventos</th></tr></thead><tbody id="rows"></tbody></table></div></section>
</main>
<footer class="footer">GUERRA FRIA RUST • Patentes calculadas por MMR • Valores individuais ocultos, ações auditáveis</footer>

<div class="modalBack" id="modalBack"><div class="modal"><div class="modalTop"><div><div class="ey">Histórico público da Season</div><div class="modalName" id="modalName">Jogador</div><div class="modalMeta" id="modalMeta">—</div></div><button class="close" id="closeModal" aria-label="Fechar">×</button></div><div class="auditIntro"><strong>O que é mostrado:</strong> quais ações entraram no cálculo e se geraram ganho ou perda. O valor de cada ação e o MMR individual não são publicados. Generais de Guerra exibem apenas a Pontuação de General usada para comparação dentro da patente máxima.</div><div class="auditGrid" id="auditGrid"></div><div class="txList" id="txList"><div class="emptyAudit">Carregando histórico...</div></div></div></div>

<script>
const SEASON=${n};
const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const num=v=>Number(v||0).toLocaleString('pt-BR');
const patentIcon=p=>p==='General de Guerra'?'🏅':p==='Coronel'?'🌟':p==='Capitão'?'⭐':p==='Soldado'?'🎖️':'🪖';
const eventLabel=v=>{
  const x=String(v||'').toLowerCase();
  const map={kill:'Eliminação PvP',player_kill:'Eliminação PvP',death:'Morte',headshot:'Headshot',assist:'Assistência',farm:'Farm',wood:'Farm de madeira',stone:'Farm de pedra',metal:'Farm de metal',sulfur:'Farm de enxofre',hqm:'Farm de HQM',raid:'Raid',raid_participation:'Participação em raid',raid_defense:'Defesa de raid',bradley:'Bradley APC',heli:'Helicóptero de Patrulha',crate:'Caixa hackeada',building:'Construção'};
  return map[x]||String(v||'Ação da Season').replaceAll('_',' ');
};
function renderGenerals(list){
  const generals=list.filter(p=>p.patente_maxima).sort((a,b)=>Number(b.general_score||0)-Number(a.general_score||0));
  document.getElementById('generalCount').textContent=generals.length+' General'+(generals.length===1?'':'is');
  const box=document.getElementById('generals');
  if(!generals.length){box.innerHTML='<div class="noGeneral">Ainda não há nenhum General de Guerra nesta Season.</div>';return}
  box.innerHTML=generals.map((p,idx)=>'<article class="general" data-steam="'+esc(p.steam_id)+'"><div class="pos">#'+(idx+1)+'</div><div><div class="name">'+esc(p.player_name)+'</div><div class="sub">🏅 General de Guerra • posição geral #'+esc(p.position)+'</div></div><div class="score"><b>'+Number(p.general_score||0).toLocaleString('pt-BR',{maximumFractionDigits:2})+'</b><span>Pontuação de General</span></div></article>').join('');
  box.querySelectorAll('.general').forEach(el=>el.addEventListener('click',()=>openPlayer(el.dataset.steam)));
}
function renderRanking(list){
  const tbody=document.getElementById('rows');
  tbody.innerHTML=list.map(p=>{
    const acts=(Array.isArray(p.actions)?p.actions:[]).slice(0,5);
    const actionHtml=acts.length?acts.map(a=>'<span class="action">'+esc(a)+'</span>').join(''):'<span class="dash">Nenhuma ação registrada</span>';
    const score=p.patente_maxima?'<span class="gscore">'+Number(p.general_score||0).toLocaleString('pt-BR',{maximumFractionDigits:2})+'</span>':'<span class="dash">Oculta</span>';
    return '<tr class="rankRow" data-steam="'+esc(p.steam_id)+'"><td class="position">#'+esc(p.position)+'</td><td><div class="player">'+esc(p.player_name)+'</div><div class="steam">'+esc(p.steam_id)+'</div></td><td><span class="patent '+(p.patente_maxima?'generalP':'')+'">'+patentIcon(p.patente)+' '+esc(p.patente)+'</span></td><td>'+score+'</td><td><div class="actions">'+actionHtml+'</div></td><td class="num">'+num(p.kills)+'</td><td class="num">'+num(p.deaths)+'</td><td class="num">'+num(p.headshots)+'</td><td class="num">'+num(p.raids_participated)+'</td><td class="num">'+num(Number(p.bradley_participations||0)+Number(p.heli_participations||0)+Number(p.crates_hacked||0))+'</td></tr>';
  }).join('');
  tbody.querySelectorAll('.rankRow').forEach(el=>el.addEventListener('click',()=>openPlayer(el.dataset.steam)));
}
async function load(){
  try{
    const r=await fetch('/api/season/'+SEASON+'?limit=250',{cache:'no-store'});
    const data=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(data.error||'Falha ao carregar');
    const list=Array.isArray(data.ranking)?data.ranking:[];
    renderGenerals(list);renderRanking(list);
    document.getElementById('loading').hidden=true;document.getElementById('table').hidden=false;
    document.getElementById('status').textContent=list.length+' jogadores classificados • MMR oculto';
    document.getElementById('updated').textContent='Atualizado agora';
    document.getElementById('dot').style.background='#22c55e';
  }catch(e){
    document.getElementById('loading').textContent='Não foi possível carregar a Season: '+e.message;
    document.getElementById('status').textContent='API da Season indisponível';
    document.getElementById('dot').style.background='#ef4444';
    document.getElementById('generals').innerHTML='<div class="noGeneral">Aguardando conexão com o banco da Season.</div>';
  }
}
async function openPlayer(steam){
  if(!steam)return;
  const back=document.getElementById('modalBack');back.classList.add('open');
  document.getElementById('modalName').textContent='Carregando...';document.getElementById('modalMeta').textContent=steam;
  document.getElementById('auditGrid').innerHTML='';document.getElementById('txList').innerHTML='<div class="emptyAudit">Carregando histórico...</div>';
  try{
    const r=await fetch('/api/season/'+SEASON+'/player/'+encodeURIComponent(steam)+'/audit?limit=100',{cache:'no-store'});
    const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Falha ao carregar');
    const p=d.player||{};
    document.getElementById('modalName').textContent=p.player_name||steam;
    document.getElementById('modalMeta').textContent=patentIcon(p.patente)+' '+(p.patente||'Sem patente')+(p.patente_maxima?' • Pontuação de General '+Number(p.general_score||0).toLocaleString('pt-BR',{maximumFractionDigits:2}):'')+' • '+steam;
    const stats=[['Kills',p.kills],['Headshots',p.headshots],['Raids',p.raids_participated],['Bradley + Heli',Number(p.bradley_participations||0)+Number(p.heli_participations||0)],['Caixas',p.crates_hacked]];
    document.getElementById('auditGrid').innerHTML=stats.map(x=>'<div class="auditStat"><b>'+num(x[1])+'</b><span>'+esc(x[0])+'</span></div>').join('');
    const tx=Array.isArray(d.transactions)?d.transactions:[];
    document.getElementById('txList').innerHTML=tx.length?tx.map(t=>'<div class="tx"><div><div class="cat">'+esc(t.category||'Season')+'</div><div class="type">'+esc(eventLabel(t.event_type))+'</div></div><div class="details">'+esc(t.details||'Ação registrada pelo servidor')+'</div><div></div><span class="dir '+esc(t.direction||'neutral')+'">'+(t.direction==='gain'?'CONTOU +':t.direction==='loss'?'CONTOU −':'REGISTRO')+'</span></div>').join(''):'<div class="emptyAudit">Nenhuma ação registrada para este jogador ainda.</div>';
  }catch(e){document.getElementById('modalName').textContent='Erro';document.getElementById('txList').innerHTML='<div class="emptyAudit">'+esc(e.message)+'</div>'}
}
document.getElementById('closeModal').addEventListener('click',()=>document.getElementById('modalBack').classList.remove('open'));
document.getElementById('modalBack').addEventListener('click',e=>{if(e.target.id==='modalBack')e.currentTarget.classList.remove('open')});
load();setInterval(load,30000);
</script>
</body></html>`;
}

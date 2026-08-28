export const panelSeasonAddonJs = String.raw`
(function(){'use strict';
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=v=>{if(!v)return'—';const d=new Date(v);return Number.isNaN(d.getTime())?'—':d.toLocaleString('pt-BR')};
let rows=[];

function ensureView(){
  if($('seasonRegistrations')) return;
  const main=document.querySelector('.main');
  if(!main) return;
  const view=document.createElement('section');
  view.id='seasonRegistrations';
  view.className='view';
  view.innerHTML='<div class="section" style="border-color:#7f1d1d"><div class="sectionHead"><div><h2>🧪 Season Beta • Inscritos</h2><div class="subtitle">Fase de teste sem premiação • balanceamento até 04/09/2026 às 18:30</div></div><span class="badge orange">BETA / TESTE</span></div><div class="body"><div class="cards" style="margin-bottom:14px"><div class="card accent"><small>Inscritos</small><strong id="seasonTotal">—</strong></div><div class="card"><small>Steam vinculado</small><strong id="seasonLinked">—</strong></div><div class="card"><small>Com dados</small><strong id="seasonData">—</strong></div><div class="card"><small>Líder atual</small><strong id="seasonLeader" style="font-size:18px">—</strong></div></div><div class="field"><label>Pesquisar inscrito</label><input id="seasonSearch" placeholder="Discord, jogador ou SteamID"></div></div><div class="tableWrap"><table class="table" style="min-width:1050px"><thead><tr><th>#</th><th>Discord</th><th>Steam</th><th>Jogador</th><th>Patente</th><th>MMR (admin)</th><th>K / D</th><th>Raids</th><th>Eventos</th><th>Cargo</th><th>Inscrição</th></tr></thead><tbody id="seasonRows"><tr><td colspan="11"><div class="empty">Carregando inscritos...</div></td></tr></tbody></table></div></div>';
  main.appendChild(view);
  $('seasonSearch').oninput=render;
}

function addNav(){
  for(const box of [document.getElementById('nav'),document.getElementById('mobileNav')]){
    if(!box||box.querySelector('[data-season-registrations]')) continue;
    const b=document.createElement('button');
    b.textContent='Season • Inscritos';
    b.dataset.seasonRegistrations='1';
    b.onclick=()=>showSeason();
    box.appendChild(b);
  }
}

function showSeason(){
  ensureView();addNav();
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  $('seasonRegistrations')?.classList.add('active');
  const title=$('pageTitle');if(title)title.textContent='Inscritos da Season';
  document.querySelectorAll('[data-view]').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('[data-season-registrations]').forEach(b=>b.classList.add('active'));
  load();
}

function render(){
  const q=String($('seasonSearch')?.value||'').trim().toLowerCase();
  const filtered=rows.filter(x=>!q||[x.discordName,x.discordId,x.playerName,x.steamId,x.rank].some(v=>String(v||'').toLowerCase().includes(q)));
  const body=$('seasonRows');if(!body)return;
  body.innerHTML=filtered.length?filtered.map(x=>'<tr><td>'+(x.position?'#'+esc(x.position):'—')+'</td><td><b>'+esc(x.discordName||'—')+'</b><div class="mono subtitle">'+esc(x.discordId||'')+'</div></td><td class="mono">'+esc(x.steamId||'Não vinculado')+'</td><td>'+esc(x.playerName||'Aguardando vínculo/dados')+'</td><td><span class="badge '+(x.rank==='General de Guerra'?'yellow':'')+'">'+esc(x.rank||'—')+'</span></td><td><b>'+(x.mmr==null?'—':Number(x.mmr).toLocaleString('pt-BR',{maximumFractionDigits:2}))+'</b></td><td>'+esc(x.kills||0)+' / '+esc(x.deaths||0)+'</td><td>'+esc(x.raids||0)+'</td><td>'+esc(x.events||0)+'</td><td><span class="status online">● Season Tester</span></td><td>'+fmt(x.createdAt)+'</td></tr>').join(''):'<tr><td colspan="11"><div class="empty">Nenhum inscrito encontrado.</div></td></tr>';
}

async function load(){
  try{
    const r=await fetch('/api/admin/season/registrations?season=1',{cache:'no-store'});
    const d=await r.json();if(!r.ok)throw new Error(d.error||('Erro '+r.status));
    rows=Array.isArray(d.registrations)?d.registrations:[];
    const s=d.summary||{};
    if($('seasonTotal'))$('seasonTotal').textContent=s.total??0;
    if($('seasonLinked'))$('seasonLinked').textContent=s.linkedSteam??0;
    if($('seasonData'))$('seasonData').textContent=s.withSeasonData??0;
    if($('seasonLeader'))$('seasonLeader').textContent=s.leader?(s.leader.playerName||s.leader.discordName||'—'):'—';
    render();
  }catch(e){if($('seasonRows'))$('seasonRows').innerHTML='<tr><td colspan="11"><div class="empty danger">'+esc(e.message)+'</div></td></tr>'}
}

function boot(){ensureView();addNav();setInterval(()=>{if($('seasonRegistrations')?.classList.contains('active'))load()},5000)}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(boot,50));else setTimeout(boot,50);
})();`;

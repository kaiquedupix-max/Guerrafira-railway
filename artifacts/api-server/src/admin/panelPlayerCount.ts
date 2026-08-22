export const panelPlayerCountJs = String.raw`
(function(){
  const $=id=>document.getElementById(id);
  async function getOverview(){
    const r=await fetch('/api/admin/overview',{cache:'no-store',credentials:'same-origin'});
    if(!r.ok) throw new Error(String(r.status));
    return r.json();
  }
  function ensureCards(){
    const view=$('serverControl');
    if(!view) return;
    const cards=view.querySelector('[data-host-pane="overview"] .cards');
    if(!cards) return;
    if(!$('serverPlayersOnline')){
      const card=document.createElement('div');
      card.className='card accent';
      card.innerHTML='<small>JOGADORES ONLINE</small><strong id="serverPlayersOnline">—</strong><div class="subtitle" id="serverPlayersDetail" style="margin-top:6px">Atualização automática</div>';
      cards.insertBefore(card,cards.children[2]||null);
    }
    if(!$('serverPlayersJoining')){
      const card=document.createElement('div');
      card.className='card';
      card.innerHTML='<small>JOINING / CONECTANDO</small><strong id="serverPlayersJoining">—</strong><div class="subtitle" id="serverJoiningDetail" style="margin-top:6px">Jogadores carregando entrada</div>';
      const onlineCard=$('serverPlayersOnline')?.closest('.card');
      if(onlineCard?.nextSibling) cards.insertBefore(card,onlineCard.nextSibling); else cards.appendChild(card);
    }
  }
  function readJoining(server,summary,d){
    const candidates=[server.joining,server.connecting,server.joiningPlayers,server.connectingPlayers,summary.joining,summary.connecting,d.joining,d.connecting];
    for(const v of candidates){ const n=Number(v); if(Number.isFinite(n)&&n>=0) return n; }
    return null;
  }
  async function update(){
    ensureCards();
    const onlineEl=$('serverPlayersOnline'), joiningEl=$('serverPlayersJoining');
    if(!onlineEl&&!joiningEl) return;
    try{
      const d=await getOverview();
      const server=d.server||{}, summary=d.summary||{};
      const online=Number(server.players??summary.onlinePlayers??0);
      const max=Number(server.maxPlayers??0);
      const queue=Number(server.queued??summary.queued??0);
      const joining=readJoining(server,summary,d);
      if(onlineEl) onlineEl.textContent=max>0?online+' / '+max:String(online);
      const detail=$('serverPlayersDetail');
      if(detail) detail.textContent=queue>0?queue+' na fila':'Sem fila';
      if(joiningEl) joiningEl.textContent=joining===null?'—':String(joining);
      const joiningDetail=$('serverJoiningDetail');
      if(joiningDetail) joiningDetail.textContent=joining===null?'Aguardando métrica do servidor':joining===1?'1 jogador conectando':joining+' jogadores conectando';
    }catch{
      if(onlineEl) onlineEl.textContent='—';
      if(joiningEl) joiningEl.textContent='—';
      const detail=$('serverPlayersDetail');
      if(detail) detail.textContent='Falha ao consultar';
      const joiningDetail=$('serverJoiningDetail');
      if(joiningDetail) joiningDetail.textContent='Falha ao consultar';
    }
  }
  const observer=new MutationObserver(()=>{ensureCards();update()});
  document.addEventListener('DOMContentLoaded',()=>{
    observer.observe(document.body,{childList:true,subtree:true});
    update();
    setInterval(update,5000);
  });
  window.addEventListener('pageshow',update);
})();
`;

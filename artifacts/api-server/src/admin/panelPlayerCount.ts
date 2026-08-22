export const panelPlayerCountJs = String.raw`
(function(){
  const $=id=>document.getElementById(id);
  async function getOverview(){
    const r=await fetch('/api/admin/overview',{cache:'no-store',credentials:'same-origin'});
    if(!r.ok) throw new Error(String(r.status));
    return r.json();
  }
  function ensureCard(){
    const view=$('serverControl');
    if(!view||$('serverPlayersOnline')) return;
    const cards=view.querySelector('[data-host-pane="overview"] .cards');
    if(!cards) return;
    const card=document.createElement('div');
    card.className='card accent';
    card.innerHTML='<small>JOGADORES ONLINE</small><strong id="serverPlayersOnline">—</strong><div class="subtitle" id="serverPlayersDetail" style="margin-top:6px">Atualização automática</div>';
    cards.insertBefore(card,cards.children[2]||null);
  }
  async function update(){
    ensureCard();
    const el=$('serverPlayersOnline');
    if(!el) return;
    try{
      const d=await getOverview();
      const server=d.server||{}, summary=d.summary||{};
      const online=Number(server.players??summary.onlinePlayers??0);
      const max=Number(server.maxPlayers??0);
      const queue=Number(server.queued??0);
      el.textContent=max>0?online+' / '+max:String(online);
      const detail=$('serverPlayersDetail');
      if(detail) detail.textContent=queue>0?queue+' na fila':'Sem fila';
    }catch{
      el.textContent='—';
      const detail=$('serverPlayersDetail');
      if(detail) detail.textContent='Falha ao consultar';
    }
  }
  const observer=new MutationObserver(()=>{ensureCard();update()});
  document.addEventListener('DOMContentLoaded',()=>{
    observer.observe(document.body,{childList:true,subtree:true});
    update();
    setInterval(update,5000);
  });
  window.addEventListener('pageshow',update);
})();
`;

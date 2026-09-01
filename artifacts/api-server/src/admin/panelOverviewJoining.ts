export const panelOverviewJoiningJs = String.raw`
(function(){
  if(window.__gfOverviewJoiningInstalled) return;
  window.__gfOverviewJoiningInstalled=true;
  const $=id=>document.getElementById(id);
  function ensure(){
    const overview=$('overview');
    if(!overview||$('ovJoining')) return;
    const cards=overview.querySelector('.cards');
    if(!cards) return;
    const card=document.createElement('div');
    card.className='card';
    card.innerHTML='<small>CONECTANDO / JOINING</small><strong id="ovJoining">—</strong><div class="subtitle" id="ovJoiningDetail" style="margin-top:6px">Jogadores carregando entrada</div>';
    const queue=$('ovQueue')?.closest('.card');
    if(queue?.nextSibling) cards.insertBefore(card,queue.nextSibling); else cards.appendChild(card);
  }
  function readJoining(server,summary,data){
    const vals=[server.joining,server.connecting,server.joiningPlayers,server.connectingPlayers,summary.joining,summary.connecting,data.joining,data.connecting];
    for(const v of vals){ const n=Number(v); if(Number.isFinite(n)&&n>=0) return n; }
    return null;
  }
  let running=false;
  async function update(){
    if(running || document.hidden) return;
    ensure();
    const el=$('ovJoining');
    if(!el) return;
    running=true;
    try{
      const r=await fetch('/api/admin/overview',{cache:'no-store',credentials:'same-origin'});
      if(!r.ok) throw new Error(String(r.status));
      const d=await r.json();
      const server=d.server||{},summary=d.summary||{};
      const joining=readJoining(server,summary,d);
      el.textContent=joining===null?'—':String(joining);
      const detail=$('ovJoiningDetail');
      if(detail) detail.textContent=joining===null?'Aguardando métrica do servidor':joining===1?'1 jogador conectando':joining+' jogadores conectando';
    }catch{
      el.textContent='—';
      const detail=$('ovJoiningDetail'); if(detail) detail.textContent='Falha ao consultar';
    }finally{running=false}
  }
  const observer=new MutationObserver(()=>{ensure();});
  document.addEventListener('DOMContentLoaded',()=>{
    observer.observe(document.body,{childList:true,subtree:true});
    ensure(); update(); window.__gfOverviewJoiningTimer=setInterval(update,15000);
  });
  window.addEventListener('pageshow',update);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)update()});
})();
`;

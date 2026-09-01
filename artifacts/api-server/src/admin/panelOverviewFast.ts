export const panelOverviewFastJs = String.raw`
(function(){
  if(window.__gfOverviewFastInstalled) return;
  window.__gfOverviewFastInstalled=true;
  const $=id=>document.getElementById(id);
  const fmt=v=>{if(!v)return'—';const d=new Date(v);return Number.isNaN(d.getTime())?'—':d.toLocaleString('pt-BR')};
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[c]||c));
  let running=false;
  async function j(url){const r=await fetch(url,{cache:'no-store',credentials:'same-origin'});if(!r.ok)throw new Error(String(r.status));return r.json()}
  async function fastOverview(){
    if(running || document.hidden) return;
    running=true;
    try{
      const [overview,players,links,vips,logs]=await Promise.all([
        j('/api/admin/overview'),j('/api/admin/players'),j('/api/admin/steam-links'),j('/api/admin/vips'),j('/api/admin/modlogs')
      ]);
      const ps=players.players||[], now=Date.now(), server=overview.server||{}, summary=overview.summary||{};
      if($('ovKnown')) $('ovKnown').textContent=String(summary.knownPlayers??ps.length);
      if($('ovOnline')) $('ovOnline').textContent=String(server.players??summary.onlinePlayers??ps.filter(p=>p.isOnline).length);
      if($('ovQueue')) $('ovQueue').textContent=String(server.queued??0);
      if($('ovSlots')) $('ovSlots').textContent=server.maxPlayers>0?String(server.maxPlayers):'—';
      if($('ovSleepers')) $('ovSleepers').textContent=Number.isFinite(Number(server.sleepers))?String(server.sleepers):'—';
      if($('ovMap')) $('ovMap').textContent=server.map||'—';
      if($('ovBoosters')) $('ovBoosters').textContent=String(summary.activeBoosters??(links.links||[]).filter(x=>x.active).length);
      if($('ovVips')) $('ovVips').textContent=String(summary.activeVips??(vips.vips||[]).filter(v=>new Date(v.expiresAt).getTime()>now).length);
      if($('overviewLogs')) $('overviewLogs').innerHTML=(logs.logs||[]).slice(0,20).map(x=>'<tr><td>'+esc(x.action)+'</td><td>'+esc(x.playerName||'—')+'</td><td>'+esc(x.adminName||'—')+'</td><td>'+esc(x.reason||'—')+'</td><td>'+fmt(x.createdAt)+'</td></tr>').join('');
    }catch{}finally{running=false}
  }
  document.addEventListener('DOMContentLoaded',()=>{fastOverview();window.__gfOverviewFastTimer=setInterval(fastOverview,15000)});
  window.addEventListener('pageshow',fastOverview);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)fastOverview()});
})();
`;
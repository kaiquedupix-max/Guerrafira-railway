export const panelOverviewFastJs = String.raw`
(function(){
  const $=id=>document.getElementById(id);
  const fmt=v=>{if(!v)return'—';const d=new Date(v);return Number.isNaN(d.getTime())?'—':d.toLocaleString('pt-BR')};
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function j(url){const r=await fetch(url,{cache:'no-store',credentials:'same-origin'});if(!r.ok)throw new Error(String(r.status));return r.json()}
  async function fastOverview(){
    try{
      const [players,links,vips,logs]=await Promise.all([
        j('/api/admin/players'),j('/api/admin/steam-links'),j('/api/admin/vips'),j('/api/admin/modlogs')
      ]);
      const ps=players.players||[], now=Date.now();
      if($('ovKnown')) $('ovKnown').textContent=String(ps.length);
      if($('ovOnline')) $('ovOnline').textContent=String(ps.filter(p=>p.isOnline).length);
      if($('ovBoosters')) $('ovBoosters').textContent=String((links.links||[]).filter(x=>x.active).length);
      if($('ovVips')) $('ovVips').textContent=String((vips.vips||[]).filter(v=>new Date(v.expiresAt).getTime()>now).length);
      if($('overviewLogs')) $('overviewLogs').innerHTML=(logs.logs||[]).slice(0,20).map(x=>'<tr><td>'+esc(x.action)+'</td><td>'+esc(x.playerName||'—')+'</td><td>'+esc(x.adminName||'—')+'</td><td>'+esc(x.reason||'—')+'</td><td>'+fmt(x.createdAt)+'</td></tr>').join('');
      if($('ovQueue') && $('ovQueue').textContent==='—') $('ovQueue').textContent='0';
      if($('ovSlots') && $('ovSlots').textContent==='—') $('ovSlots').textContent=String(ps.filter(p=>p.isOnline).length);
    }catch{}
  }
  document.addEventListener('DOMContentLoaded',()=>{fastOverview();setInterval(fastOverview,5000)});
  window.addEventListener('pageshow',fastOverview);
})();
`;
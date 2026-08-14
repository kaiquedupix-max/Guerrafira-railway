export const overviewLiteJs = `
(function(){
  function e(id){return document.getElementById(id)}
  async function j(url){try{var r=await fetch(url);if(!r.ok)return null;return await r.json()}catch(_){return null}}
  async function refresh(){
    var a=await Promise.all([j('/api/admin/server/online'),j('/api/admin/players'),j('/api/admin/steam-links'),j('/api/admin/vips')]);
    var srv=a[0],players=a[1],links=a[2],vips=a[3];
    if(srv){var info=srv.info||{};var count=typeof info.players==='number'?info.players:((srv.players||[]).length);if(e('online'))e('online').textContent=String(count);if(e('queue'))e('queue').textContent=String(info.queued||0);if(e('sleepers'))e('sleepers').textContent=String(info.sleepers||0);if(e('slots'))e('slots').textContent=String(count)+'/'+String(info.maxPlayers||0);if(e('map'))e('map').textContent=info.map||'Indisponível'}
    if(players&&Array.isArray(players.players)&&e('known'))e('known').textContent=String(players.players.length);
    if(links&&Array.isArray(links.links)&&e('boostersCount'))e('boostersCount').textContent=String(links.links.filter(function(x){return !!x.active}).length);
    if(vips&&Array.isArray(vips.vips)&&e('vipsCount')){var now=Date.now();e('vipsCount').textContent=String(vips.vips.filter(function(x){return x.expiresAt&&new Date(x.expiresAt).getTime()>now}).length)}
  }
  setTimeout(refresh,300);setInterval(refresh,20000);
})();
`;

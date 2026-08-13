export const adminExtraJs = `
(function(){
  function e(id){return document.getElementById(id)}
  function addFinance(box){
    if(!box||box.querySelector('[data-finance-link]'))return;
    const b=document.createElement('button');
    b.textContent='Financeiro';
    b.dataset.financeLink='1';
    b.onclick=function(){window.location.href='/api/finance/revenue-view?days=30'};
    box.appendChild(b);
  }
  setTimeout(function(){addFinance(e('nav'));addFinance(e('mobileNav'))},150);

  async function safeJson(url){
    try{
      const r=await fetch(url);
      if(!r.ok)return null;
      return await r.json();
    }catch(_){return null}
  }

  async function fillFallbackData(){
    const [playersData,linksData,vipsData,logsData]=await Promise.all([
      safeJson('/api/admin/players'),
      safeJson('/api/admin/steam-links'),
      safeJson('/api/admin/vips'),
      safeJson('/api/admin/modlogs')
    ]);

    if(playersData&&Array.isArray(playersData.players)){
      if(e('known'))e('known').textContent=String(playersData.players.length);
      if(e('online'))e('online').textContent=String(playersData.players.filter(function(p){return !!p.isOnline}).length);
    }
    if(linksData&&Array.isArray(linksData.links)){
      if(e('linksCount'))e('linksCount').textContent=String(linksData.links.length);
      if(e('boostersCount'))e('boostersCount').textContent=String(linksData.links.filter(function(x){return !!x.active}).length);
    }
    if(vipsData&&Array.isArray(vipsData.vips)){
      const now=Date.now();
      if(e('vipsCount'))e('vipsCount').textContent=String(vipsData.vips.filter(function(v){return new Date(v.expiresAt).getTime()>now}).length);
    }
    if(logsData&&Array.isArray(logsData.logs)&&e('recentLogs')){
      e('recentLogs').innerHTML=logsData.logs.slice(0,20).map(function(x){
        return '<tr><td><span class="pill">'+String(x.action||'—')+'</span></td><td>'+String(x.playerName||'—')+'</td><td class="mono">'+String(x.steamId||'—')+'</td><td>'+String(x.adminName||'—')+'</td><td>'+String(x.reason||'—')+'</td></tr>';
      }).join('');
    }
    if(e('queue')&&e('queue').textContent==='—')e('queue').textContent='0';
    if(e('map')&&e('map').textContent==='—')e('map').textContent='RCON indisponível';
    if(e('slots')&&e('slots').textContent==='—')e('slots').textContent='—';
  }

  setTimeout(function(){
    const mobile=e('mobileNav');
    if(mobile&&mobile.children.length<=1&&typeof window.nav==='function'){
      try{window.nav()}catch(_){}
    }
    const known=e('known');
    if(known&&known.textContent==='—')fillFallbackData();
  },900);

  const old=window.selectPlayer;
  if(typeof old==='function'){
    window.selectPlayer=function(id,name){window.gfPlayer={steamId:id,name:name};return old(id,name)};
  }
  const players=e('players');
  if(players&&!e('verifyBtn')){
    const box=document.createElement('div'); box.className='section';
    box.innerHTML='<div class="sectionHead"><h2>🛡️ Verificação de jogador</h2><span>Discord + grupo vr</span></div><div class="body"><div class="form"><p class="hint">Selecione o jogador acima e informe o Discord ID.</p><div class="field"><label>Discord ID</label><input id="verifyDiscord"></div><button class="btn green" id="verifyBtn">Verificar jogador</button></div></div>';
    players.appendChild(box);
    e('verifyBtn').onclick=function(){const p=window.gfPlayer;if(!p)return toast('Selecione um jogador primeiro.',true);const d=e('verifyDiscord').value.trim();if(!d)return toast('Informe o Discord ID.',true);post('/api/admin/moderation/verify',{steamId:p.steamId,discordUserId:d},'Confirmar verificação de '+p.name+'?')};
  }
})();
`;

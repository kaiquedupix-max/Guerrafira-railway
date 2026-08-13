export const adminExtraJs = `
(function(){
  function e(id){return document.getElementById(id)}
  function esc(v){return String(v==null?'':v).replace(/[&<>\"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]})}
  async function getJson(url,opt){var r=await fetch(url,opt||{});var j={};try{j=await r.json()}catch(_x){}if(!r.ok)throw new Error(j.error||('Erro '+r.status));return j}
  async function postJson(url,data){return getJson(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data||{})})}
  var pages={overview:'Visão Geral',players:'Jogadores',chat:'Chat ao vivo',events:'Eventos',steam:'Steam / Boosters',vip:'VIPs',finance:'Financeiro',logs:'Logs'};
  var selected=null;

  function translate(){
    var dict={'Resumen':'Visão Geral','Jugadores online':'Jogadores online','Cola':'Fila','Durmientes':'Dormindo','Conocidos':'Jogadores conhecidos','VIP activos':'VIPs ativos','Actividad reciente':'Atividade recente','Jugadores':'Jogadores','Acciones':'Ações','Selecciona un jugador':'Selecione um jogador','Banear':'Banir','Desbanear':'Desbanir','Cantidad':'Quantidade','Vaciar inventario':'Limpar inventário','Dar item':'Dar item','Teleportar a SteamID':'Teleportar para SteamID','Chat del juego':'Chat do jogo','No se guarda en la base':'Não é salvo no banco de dados','Enviar como MODERACIÓN':'Enviar como MODERAÇÃO','Eventos detectados':'Eventos detectados','Actualizar':'Atualizar','Finanzas':'Financeiro','Finanzas • Mercado Pago':'Financeiro • Mercado Pago','Facturación bruta':'Faturamento bruto','Facturación neta':'Faturamento líquido','Aprobados':'Aprovados','Fecha':'Data','Descripción':'Descrição','Historial de moderación':'Histórico de moderação','Estado':'Status','Jugador':'Jogador','Última vez':'Última vez','Todos':'Todos','Motivo':'Motivo','Permanente':'Permanente','Reembolsado':'Reembolsado'};
    var all=document.querySelectorAll('h1,h2,h3,small,label,button,span,th,option');
    for(var i=0;i<all.length;i++){var t=(all[i].textContent||'').trim();if(dict[t])all[i].textContent=dict[t]}
    var ph={playerSearch:'Buscar nome ou SteamID',reason:'Motivo da ação',giveItem:'Ex.: rifle.ak',tpTo:'SteamID de destino',verifyDiscord:'Discord ID do jogador',chatInput:'Mensagem da moderação...'};
    Object.keys(ph).forEach(function(id){if(e(id))e(id).placeholder=ph[id]});
    if(e('pageTitle'))e('pageTitle').textContent='Visão Geral';
  }

  function show(id){
    var vs=document.querySelectorAll('.view');for(var i=0;i<vs.length;i++)vs[i].classList.remove('active');
    if(e(id))e(id).classList.add('active');
    if(e('pageTitle'))e('pageTitle').textContent=pages[id]||'Painel';
    var buttons=document.querySelectorAll('[data-view]');for(var j=0;j<buttons.length;j++)buttons[j].classList.toggle('active',buttons[j].dataset.view===id);
    if(id==='players')loadPlayers();if(id==='chat')loadChat();if(id==='events')loadEvents();if(id==='steam')loadSteam();if(id==='vip')loadVips();if(id==='finance'&&typeof window.loadFinance==='function')window.loadFinance();if(id==='logs')loadLogs();
  }
  window.gfShow=show;

  function buildNav(){
    var boxes=[e('nav'),e('mobileNav')],ids=Object.keys(pages);
    for(var b=0;b<boxes.length;b++){if(!boxes[b])continue;boxes[b].innerHTML='';for(var i=0;i<ids.length;i++){var id=ids[i],bt=document.createElement('button');bt.textContent=pages[id];bt.dataset.view=id;bt.onclick=(function(x){return function(){show(x)}})(id);boxes[b].appendChild(bt)}}
  }

  async function loadOverview(){
    var o=null,s=null;try{o=await getJson('/api/admin/overview')}catch(_a){}try{s=await getJson('/api/admin/server/online')}catch(_b){}
    var info=(s&&s.info)||(o&&o.server)||{};var count=typeof info.players==='number'?info.players:(s&&s.players?s.players.length:0);
    if(e('online'))e('online').textContent=String(count);if(e('queue'))e('queue').textContent=String(info.queued||0);if(e('sleepers'))e('sleepers').textContent=String(info.sleepers||0);if(e('slots'))e('slots').textContent=String(count)+'/'+String(info.maxPlayers||0);if(e('map'))e('map').textContent=info.map||'Indisponível';
    if(o&&o.summary){if(e('known'))e('known').textContent=String(o.summary.knownPlayers||0);if(e('vipsCount'))e('vipsCount').textContent=String(o.summary.activeVips||0);if(e('boostersCount'))e('boostersCount').textContent=String(o.summary.activeBoosters||0)}
    if(o&&Array.isArray(o.recentModeration)&&e('recentLogs'))e('recentLogs').innerHTML=o.recentModeration.map(function(x){return '<tr><td>'+esc(x.action)+'</td><td>'+esc(x.playerName)+'</td><td>'+esc(x.adminName)+'</td><td>'+esc(x.reason||'—')+'</td></tr>'}).join('');
  }

  function openPlayerModal(p){
    selected=p;
    var old=e('gfPlayerModal');if(old)old.remove();
    var wrap=document.createElement('div');wrap.id='gfPlayerModal';wrap.style.cssText='position:fixed;inset:0;background:#000b;z-index:99999;display:flex;align-items:flex-end;justify-content:center;padding:12px';
    var online=!!p.isOnline;
    wrap.innerHTML='<div style="width:min(680px,100%);max-height:88vh;overflow:auto;background:#0e0a15;border:1px solid #49336c;border-radius:20px 20px 14px 14px;padding:18px;box-shadow:0 -20px 70px #000">'
      +'<div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start"><div><div style="font-size:11px;color:#9b8ba9;text-transform:uppercase;font-weight:900">Jogador selecionado</div><h2 style="margin:5px 0">'+esc(p.name||p.playerName||'Jogador')+'</h2><div class="mono" style="color:#a99db7">'+esc(p.steamId)+'</div></div><button id="gfClosePlayer" class="btn">Fechar</button></div>'
      +'<div style="margin-top:15px;padding:10px;border:1px solid #30243f;border-radius:10px;color:'+(online?'#74e99a':'#9b8ba9')+'">● '+(online?'Online':'Offline')+(p.ping!=null?' • '+esc(p.ping)+' ms':'')+'</div>'
      +'<div style="margin-top:15px"><label style="display:block;color:#9b8ba9;font-size:11px;margin-bottom:5px">Motivo</label><input id="gfReason" placeholder="Informe o motivo da ação"></div>'
      +'<div style="margin-top:10px"><label style="display:block;color:#9b8ba9;font-size:11px;margin-bottom:5px">Duração do ban</label><select id="gfBanDuration"><option value="3d">3 dias</option><option value="7d">7 dias</option><option value="30d">30 dias</option><option value="perm">Permanente</option></select></div>'
      +'<div class="row" style="margin-top:14px"><button id="gfBan" class="btn red">Banir</button><button id="gfKick" class="btn">Kickar</button><button id="gfUnban" class="btn green">Desbanir</button></div>'
      +'<hr style="border:0;border-top:1px solid #30243f;margin:18px 0">'
      +'<div class="forms"><div><label style="display:block;color:#9b8ba9;font-size:11px;margin-bottom:5px">Item</label><input id="gfItem" placeholder="Ex.: rifle.ak"><label style="display:block;color:#9b8ba9;font-size:11px;margin:8px 0 5px">Quantidade</label><input id="gfAmount" type="number" value="1"><button id="gfGive" class="btn yellow" style="margin-top:8px">Dar item</button></div>'
      +'<div><label style="display:block;color:#9b8ba9;font-size:11px;margin-bottom:5px">Teleportar para SteamID</label><input id="gfTp" placeholder="7656119..."><button id="gfTeleport" class="btn" style="margin-top:8px">Teleportar</button><button id="gfClear" class="btn red" style="margin-top:8px">Limpar inventário</button></div></div>'
      +'<hr style="border:0;border-top:1px solid #30243f;margin:18px 0">'
      +'<label style="display:block;color:#9b8ba9;font-size:11px;margin-bottom:5px">Discord ID para verificação</label><input id="gfDiscordVerify" placeholder="ID do usuário no Discord"><button id="gfVerify" class="btn green" style="margin-top:8px">Verificar jogador + VR</button>'
      +'</div>';
    document.body.appendChild(wrap);
    e('gfClosePlayer').onclick=function(){wrap.remove()};wrap.onclick=function(ev){if(ev.target===wrap)wrap.remove()};
    function reason(){return (e('gfReason').value||'').trim()}
    e('gfBan').onclick=async function(){if(!reason())return alert('Informe o motivo.');if(!confirm('Banir '+(p.name||p.playerName)+'?'))return;try{await postJson('/api/admin/moderation/ban',{steamId:p.steamId,duration:e('gfBanDuration').value,reason:reason()});alert('Banimento aplicado.');wrap.remove();loadPlayers()}catch(err){alert(err.message)}};
    e('gfKick').onclick=async function(){if(!reason())return alert('Informe o motivo.');try{await postJson('/api/admin/moderation/kick',{steamId:p.steamId,reason:reason()});alert('Jogador kickado.');wrap.remove()}catch(err){alert(err.message)}};
    e('gfUnban').onclick=async function(){try{await postJson('/api/admin/moderation/unban',{steamId:p.steamId});alert('Jogador desbanido.');wrap.remove()}catch(err){alert(err.message)}};
    e('gfGive').onclick=async function(){try{await postJson('/api/admin/server/give',{steamId:p.steamId,item:e('gfItem').value,amount:Number(e('gfAmount').value||1)});alert('Item enviado.')}catch(err){alert(err.message)}};
    e('gfClear').onclick=async function(){if(!confirm('Limpar o inventário deste jogador?'))return;try{await postJson('/api/admin/server/clear-inventory',{steamId:p.steamId});alert('Inventário limpo.')}catch(err){alert(err.message)}};
    e('gfTeleport').onclick=async function(){try{await postJson('/api/admin/server/teleport',{from:p.steamId,to:e('gfTp').value});alert('Teleport executado.')}catch(err){alert(err.message)}};
    e('gfVerify').onclick=async function(){try{await postJson('/api/admin/moderation/verify',{steamId:p.steamId,discordUserId:e('gfDiscordVerify').value});alert('Jogador verificado.');wrap.remove()}catch(err){alert(err.message)}};
  }

  function renderPlayers(rows){
    if(!e('playerRows'))return;
    e('playerRows').innerHTML='';
    (rows||[]).forEach(function(p){var tr=document.createElement('tr');tr.style.cursor='pointer';tr.innerHTML='<td class="'+(p.isOnline?'online':'offline')+'">'+(p.isOnline?'● Online':'● Offline')+'</td><td>'+esc(p.playerName||p.name)+'</td><td class="mono">'+esc(p.steamId)+'</td><td>'+(p.ping!=null?esc(p.ping)+' ms':(p.lastSeen?new Date(p.lastSeen).toLocaleString('pt-BR'):'—'))+'</td>';tr.onclick=function(){openPlayerModal({steamId:p.steamId,name:p.playerName||p.name,isOnline:p.isOnline,ping:p.ping,lastSeen:p.lastSeen})};e('playerRows').appendChild(tr)});
  }
  async function loadPlayers(){try{var q=e('playerSearch')?e('playerSearch').value:'';var d=await getJson('/api/admin/players?q='+encodeURIComponent(q));renderPlayers(d.players||[])}catch(_e){}}
  async function loadOnlinePlayers(){try{var d=await getJson('/api/admin/server/online');renderPlayers((d.players||[]).map(function(p){p.isOnline=true;return p}))}catch(_e){}}

  async function loadChat(){
    try{var d=await getJson('/api/admin/server/chat');if(e('chatBox')){e('chatBox').innerHTML=(d.messages||[]).map(function(m){return '<div class="msg '+(m.type==='moderation'?'mod':'')+'"><b>'+esc(m.player||'Jogador')+'</b> <small>'+new Date(m.at).toLocaleTimeString('pt-BR')+'</small><div>'+esc(m.message)+'</div></div>'}).join('');e('chatBox').scrollTop=e('chatBox').scrollHeight}}catch(_e){}
  }
  async function sendChat(){var input=e('chatInput');if(!input||!input.value.trim())return;var msg=input.value.trim();input.disabled=true;try{await postJson('/api/admin/server/chat',{message:msg});input.value='';await loadChat()}catch(err){alert(err.message)}finally{input.disabled=false;input.focus()}}

  async function loadEvents(){try{var d=await getJson('/api/admin/server/events');if(e('eventGrid'))e('eventGrid').innerHTML=(d.events||[]).map(function(x){return '<div class="event"><b>'+esc(x.label)+'</b><div class="'+(x.active?'online':'offline')+'">'+(x.active?'● ATIVO':'● NÃO DETECTADO')+'</div><div class="sub">Última detecção: '+(x.lastSeen?new Date(x.lastSeen).toLocaleString('pt-BR'):'Sem dados')+'</div></div>'}).join('')}catch(_e){}}
  async function loadSteam(){try{var d=await getJson('/api/admin/steam-links');if(e('steamRows'))e('steamRows').innerHTML=(d.links||[]).map(function(x){return '<tr><td>'+esc(x.discordUserId)+'</td><td>'+esc(x.steamId)+'</td><td>'+(x.active?'Ativo':'Inativo')+'</td></tr>'}).join('')}catch(_e){}}
  async function loadVips(){try{var d=await getJson('/api/admin/vips');if(e('vipRows'))e('vipRows').innerHTML=(d.vips||[]).map(function(v){return '<tr><td>'+esc(v.id)+'</td><td>'+esc(v.steamId)+'</td><td>'+esc(v.vipTier)+'</td><td>'+(v.expiresAt?new Date(v.expiresAt).toLocaleString('pt-BR'):'—')+'</td></tr>'}).join('')}catch(_e){}}
  async function loadLogs(){try{var d=await getJson('/api/admin/modlogs');if(e('logRows'))e('logRows').innerHTML=(d.logs||[]).map(function(x){return '<tr><td>'+(x.createdAt?new Date(x.createdAt).toLocaleString('pt-BR'):'—')+'</td><td>'+esc(x.action)+'</td><td>'+esc(x.playerName)+'</td><td>'+esc(x.adminName)+'</td><td>'+esc(x.reason||'—')+'</td></tr>'}).join('')}catch(_e){}}

  function bindButtons(){
    var onlineBtns=document.querySelectorAll('button');for(var i=0;i<onlineBtns.length;i++){var t=(onlineBtns[i].textContent||'').trim();if(t==='Online')onlineBtns[i].onclick=loadOnlinePlayers;if(t==='Todos')onlineBtns[i].onclick=loadPlayers}
    var sendButtons=document.querySelectorAll('button');for(var j=0;j<sendButtons.length;j++){var s=(sendButtons[j].textContent||'').trim();if(s==='Enviar como MODERAÇÃO'||s==='Enviar como MODERACIÓN')sendButtons[j].onclick=sendChat}
    if(e('chatInput'))e('chatInput').addEventListener('keydown',function(ev){if((ev.ctrlKey||ev.metaKey)&&ev.key==='Enter'){ev.preventDefault();sendChat()}});
  }

  function polishMobile(){
    var style=document.createElement('style');style.textContent='@media(max-width:900px){#players .table{min-width:760px}#players .tableWrap{overflow-x:auto;-webkit-overflow-scrolling:touch}.mobile{position:sticky;top:0;z-index:30;background:#08060df2;padding:8px 0}.mobile button{font-size:13px}.top h1{font-size:34px}.card{min-height:120px}.table td,.table th{white-space:nowrap}#gfPlayerModal .forms{grid-template-columns:1fr}}';document.head.appendChild(style);
  }

  function start(){translate();buildNav();polishMobile();bindButtons();if(e('app'))e('app').style.display='grid';if(e('login'))e('login').style.display='none';var ps=e('playerSearch');if(ps&&!ps.dataset.gfBound){ps.dataset.gfBound='1';ps.addEventListener('input',function(){clearTimeout(window.gfSearch);window.gfSearch=setTimeout(loadPlayers,220)})}var card=e('online');if(card&&card.parentElement)card.parentElement.onclick=function(){show('players')};loadOverview()}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
  setTimeout(start,700);setInterval(loadOverview,30000);setInterval(function(){if(e('chat')&&e('chat').classList.contains('active'))loadChat()},2500);
})();
`;
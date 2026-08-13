export const adminExtraJs = `
(function(){
  function e(id){return document.getElementById(id)}
  function money(v){return Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}
  function esc2(v){return String(v??'').replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}

  function ensureFinanceView(){
    if(e('finance'))return;
    const main=document.querySelector('.main');
    if(!main)return;
    const s=document.createElement('section');
    s.id='finance'; s.className='view';
    s.innerHTML=''
      +'<div class="grid">'
      +'<div class="card em"><small>Faturamento</small><strong id="finRevenue">—</strong></div>'
      +'<div class="card"><small>Vendas aprovadas</small><strong id="finSales">—</strong></div>'
      +'<div class="card"><small>Ticket médio</small><strong id="finAvg">—</strong></div>'
      +'<div class="card"><small>Reembolsado</small><strong id="finRefunded">—</strong></div>'
      +'</div>'
      +'<div class="section"><div class="sectionHead"><h2>Financeiro do servidor</h2><span>VIPs, pagamentos e ajustes manuais</span></div><div class="body">'
      +'<div class="forms">'
      +'<div class="form"><h3>📊 Período e filtros</h3><div class="field"><label>Período</label><select id="finDays"><option value="7">7 dias</option><option value="15">15 dias</option><option value="30" selected>30 dias</option><option value="60">60 dias</option><option value="90">90 dias</option><option value="365">1 ano</option></select></div><div class="field"><label>Status</label><select id="finStatus"><option value="">Todos</option><option value="approved">Aprovado</option><option value="pending">Pendente</option><option value="refunded">Reembolsado</option><option value="cancelled">Cancelado</option><option value="rejected">Recusado</option></select></div><div class="field"><label>Buscar</label><input id="finSearch" placeholder="SteamID, Discord, VIP ou pagamento"></div><button class="btn" id="finFilterBtn">Aplicar filtros</button></div>'
      +'<div class="form"><h3>➕ Cadastrar lançamento</h3><div class="field"><label>Valor</label><input id="finNewAmount" type="number" step="0.01" min="0" placeholder="49.90"></div><div class="field"><label>VIP / descrição</label><input id="finNewTier" placeholder="ouro"></div><div class="field"><label>Discord ID</label><input id="finNewDiscord" placeholder="Opcional"></div><div class="field"><label>SteamID</label><input id="finNewSteam" placeholder="Opcional"></div><div class="field"><label>Método</label><select id="finNewMethod"><option value="manual">Manual</option><option value="pix">PIX</option><option value="credit_card">Cartão</option><option value="cash">Dinheiro</option></select></div><div class="field"><label>Status</label><select id="finNewStatus"><option value="approved">Aprovado</option><option value="pending">Pendente</option><option value="refunded">Reembolsado</option><option value="cancelled">Cancelado</option></select></div><button class="btn yellow" id="finAddBtn">Cadastrar lançamento</button></div>'
      +'</div></div></div>'
      +'<div class="section"><div class="sectionHead"><h2>Faturamento por dia</h2><span id="finPeriodLabel">Últimos 30 dias</span></div><div class="body"><div id="finChart" style="display:flex;align-items:end;gap:5px;height:180px;overflow-x:auto;padding-top:16px"></div></div></div>'
      +'<div class="section"><div class="sectionHead"><h2>Vendas e lançamentos</h2><span>Mercado Pago + manual</span></div><div class="tableWrap"><table class="table"><thead><tr><th>Data</th><th>VIP</th><th>Valor</th><th>Método</th><th>Status</th><th>Discord</th><th>SteamID</th><th>Origem</th><th>Ações</th></tr></thead><tbody id="finRows"></tbody></table></div></div>';
    main.appendChild(s);
  }

  function addFinance(box){
    if(!box||box.querySelector('[data-finance-link]'))return;
    const b=document.createElement('button');
    b.textContent='Financeiro'; b.dataset.financeLink='1'; b.dataset.view='finance';
    b.onclick=function(){openFinance()};
    box.appendChild(b);
  }

  function openFinance(){
    ensureFinanceView();
    document.querySelectorAll('.view').forEach(function(x){x.classList.remove('active')});
    e('finance').classList.add('active');
    document.querySelectorAll('[data-view]').forEach(function(x){x.classList.toggle('active',x.dataset.view==='finance')});
    if(e('title'))e('title').textContent='Financeiro';
    loadFinance();
  }

  async function loadFinance(){
    try{
      const days=e('finDays')?e('finDays').value:'30';
      const status=e('finStatus')?e('finStatus').value:'';
      const q=e('finSearch')?e('finSearch').value:'';
      const d=await api('/api/admin/finance?days='+encodeURIComponent(days)+'&status='+encodeURIComponent(status)+'&q='+encodeURIComponent(q));
      const s=d.summary||{};
      e('finRevenue').textContent=money(s.revenue); e('finSales').textContent=String(s.sales||0); e('finAvg').textContent=money(s.avg_ticket); e('finRefunded').textContent=money(s.refunded);
      e('finPeriodLabel').textContent='Últimos '+days+' dias';
      drawFinanceChart(d.trend||[]);
      e('finRows').innerHTML=(d.sales||[]).map(function(x){
        const origin=x.manual?'Manual':'Mercado Pago';
        return '<tr>'
          +'<td>'+new Date(x.created_at).toLocaleString('pt-BR')+'</td>'
          +'<td>'+esc2(x.vip_tier||'—')+'</td>'
          +'<td>'+money(x.amount)+'</td>'
          +'<td>'+esc2(x.method||'—')+'</td>'
          +'<td><span class="pill">'+esc2(x.status||'—')+'</span></td>'
          +'<td class="mono">'+esc2(x.discord_user_id||'—')+'</td>'
          +'<td class="mono">'+esc2(x.steam_id||'—')+'</td>'
          +'<td>'+origin+'</td>'
          +'<td><button class="btn" onclick="window.gfEditFinance('+Number(x.id)+')">Editar</button> '+(x.manual?'<button class="btn red" onclick="window.gfDeleteFinance('+Number(x.id)+')">Excluir</button>':'')+'</td>'
          +'</tr>';
      }).join('');
      window.gfFinanceRows=d.sales||[];
    }catch(err){toast(err.message||'Falha ao carregar financeiro',true)}
  }

  function drawFinanceChart(rows){
    const box=e('finChart'); if(!box)return;
    const max=Math.max(1,...rows.map(function(x){return Number(x.revenue||0)}));
    box.innerHTML=rows.map(function(x){
      const h=Math.max(3,Math.round((Number(x.revenue||0)/max)*140));
      return '<div title="'+esc2(x.label)+' • '+money(x.revenue)+'" style="min-width:18px;display:flex;flex-direction:column;align-items:center;justify-content:end;height:165px"><div style="width:14px;height:'+h+'px;background:linear-gradient(180deg,#ffd84d,#8b5cf6);border-radius:5px 5px 2px 2px"></div><small style="font-size:7px;color:#7f748c;transform:rotate(-55deg);margin-top:13px;white-space:nowrap">'+esc2(x.label)+'</small></div>';
    }).join('');
  }

  async function addFinanceEntry(){
    const amount=Number(e('finNewAmount').value||0);
    if(!amount)return toast('Informe o valor do lançamento.',true);
    try{
      await api('/api/admin/finance/manual',{method:'POST',body:JSON.stringify({amount:amount,vipTier:e('finNewTier').value,discordUserId:e('finNewDiscord').value,steamId:e('finNewSteam').value,method:e('finNewMethod').value,status:e('finNewStatus').value})});
      e('finNewAmount').value=''; e('finNewTier').value=''; e('finNewDiscord').value=''; e('finNewSteam').value='';
      toast('Lançamento cadastrado.'); loadFinance();
    }catch(err){toast(err.message,true)}
  }

  window.gfEditFinance=async function(id){
    const row=(window.gfFinanceRows||[]).find(function(x){return Number(x.id)===Number(id)}); if(!row)return;
    const amount=prompt('Valor da venda:',String(row.amount||0)); if(amount===null)return;
    const tier=prompt('VIP / descrição:',String(row.vip_tier||'')); if(tier===null)return;
    const method=prompt('Método de pagamento:',String(row.method||'')); if(method===null)return;
    const status=prompt('Status (approved, pending, refunded, cancelled, rejected):',String(row.status||'approved')); if(status===null)return;
    const discord=prompt('Discord ID:',String(row.discord_user_id||'')); if(discord===null)return;
    const steam=prompt('SteamID:',String(row.steam_id||'')); if(steam===null)return;
    try{await api('/api/admin/finance/'+id,{method:'PATCH',body:JSON.stringify({amount:Number(amount),vipTier:tier,method:method,status:status,discordUserId:discord,steamId:steam})});toast('Venda atualizada.');loadFinance()}catch(err){toast(err.message,true)}
  };

  window.gfDeleteFinance=async function(id){
    if(!confirm('Excluir este lançamento manual?'))return;
    try{await api('/api/admin/finance/'+id,{method:'DELETE'});toast('Lançamento removido.');loadFinance()}catch(err){toast(err.message,true)}
  };

  ensureFinanceView();
  setTimeout(function(){addFinance(e('nav'));addFinance(e('mobileNav'));if(e('finFilterBtn'))e('finFilterBtn').onclick=loadFinance;if(e('finAddBtn'))e('finAddBtn').onclick=addFinanceEntry},150);

  async function safeJson(url){try{const r=await fetch(url);if(!r.ok)return null;return await r.json()}catch(_){return null}}
  async function fillFallbackData(){
    const a=await Promise.all([safeJson('/api/admin/players'),safeJson('/api/admin/steam-links'),safeJson('/api/admin/vips'),safeJson('/api/admin/modlogs')]);
    const playersData=a[0],linksData=a[1],vipsData=a[2],logsData=a[3];
    if(playersData&&Array.isArray(playersData.players)){if(e('known'))e('known').textContent=String(playersData.players.length);if(e('online'))e('online').textContent=String(playersData.players.filter(function(p){return !!p.isOnline}).length)}
    if(linksData&&Array.isArray(linksData.links)){if(e('linksCount'))e('linksCount').textContent=String(linksData.links.length);if(e('boostersCount'))e('boostersCount').textContent=String(linksData.links.filter(function(x){return !!x.active}).length)}
    if(vipsData&&Array.isArray(vipsData.vips)){const now=Date.now();if(e('vipsCount'))e('vipsCount').textContent=String(vipsData.vips.filter(function(v){return new Date(v.expiresAt).getTime()>now}).length)}
    if(logsData&&Array.isArray(logsData.logs)&&e('recentLogs')){e('recentLogs').innerHTML=logsData.logs.slice(0,20).map(function(x){return '<tr><td><span class="pill">'+String(x.action||'—')+'</span></td><td>'+String(x.playerName||'—')+'</td><td class="mono">'+String(x.steamId||'—')+'</td><td>'+String(x.adminName||'—')+'</td><td>'+String(x.reason||'—')+'</td></tr>'}).join('')}
    if(e('queue')&&e('queue').textContent==='—')e('queue').textContent='0';
    if(e('map')&&e('map').textContent==='—')e('map').textContent='RCON indisponível';
  }
  setTimeout(function(){const known=e('known');if(known&&known.textContent==='—')fillFallbackData()},900);

  const old=window.selectPlayer;
  if(typeof old==='function'){window.selectPlayer=function(id,name){window.gfPlayer={steamId:id,name:name};return old(id,name)}}
  const players=e('players');
  if(players&&!e('verifyBtn')){
    const box=document.createElement('div'); box.className='section';
    box.innerHTML='<div class="sectionHead"><h2>🛡️ Verificação de jogador</h2><span>Discord + grupo vr</span></div><div class="body"><div class="form"><p class="hint">Selecione o jogador acima e informe o Discord ID.</p><div class="field"><label>Discord ID</label><input id="verifyDiscord"></div><button class="btn green" id="verifyBtn">Verificar jogador</button></div></div>';
    players.appendChild(box);
    e('verifyBtn').onclick=function(){const p=window.gfPlayer;if(!p)return toast('Selecione um jogador primeiro.',true);const d=e('verifyDiscord').value.trim();if(!d)return toast('Informe o Discord ID.',true);post('/api/admin/moderation/verify',{steamId:p.steamId,discordUserId:d},'Confirmar verificação de '+p.name+'?')};
  }
})();
`;

export const panelStabilityJs = String.raw`
(function(){
'use strict';
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const brl=v=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const date=v=>{if(!v)return'—';const d=new Date(v);return isNaN(d.getTime())?'—':d.toLocaleString('pt-BR')};

function removeLegacyPlayerActions(){
  const players=$('players'); if(!players)return;
  players.querySelectorAll('.section').forEach(sec=>{
    const title=sec.querySelector('.sectionHead h2,h2');
    if(title && (title.textContent||'').trim().toLowerCase()==='ações') sec.remove();
  });
}

function addVersion(){
  if($('gfPanelVersion'))return;
  const sub=document.querySelector('.subtitle');
  if(!sub)return;
  const b=document.createElement('span');b.id='gfPanelVersion';b.textContent=' • Painel v3.2';b.style.cssText='color:#ffd84d;font-size:10px;font-weight:900';sub.appendChild(b);
}

async function json(url){
  const r=await fetch(url);let j={};try{j=await r.json()}catch{}
  if(!r.ok)throw new Error(j.error||('Erro '+r.status));return j;
}

async function stableFinance(){
  if(!$('finGross'))return;
  const days=$('financeDays')?.value||'30';
  try{
    let d;
    try{d=await json('/api/admin/finance/live?days='+encodeURIComponent(days));}
    catch(liveErr){
      const db=await json('/api/admin/finance?days='+encodeURIComponent(days));
      d={
        source:'database_fallback',
        summary:{grossRevenue:db.summary?.revenue||0,refunded:db.summary?.refunded||0,netRevenue:(db.summary?.revenue||0)-(db.summary?.refunded||0),approved:db.summary?.sales||0},
        trend:(db.trend||[]).map(x=>({day:x.label,revenue:Number(x.revenue||0)})),
        payments:(db.sales||[]).map(x=>({dateApproved:x.created_at,id:x.mp_payment_id,description:x.vip_tier||'VIP',method:x.method,status:x.status,amount:x.amount}))
      };
    }
    const s=d.summary||{};
    $('finGross').textContent=brl(s.grossRevenue);
    $('finRefunded').textContent=brl(s.refunded);
    $('finNet').textContent=brl(s.netRevenue);
    $('finApproved').textContent=String(s.approved||0);
    const vals=d.trend||[],max=Math.max(1,...vals.map(x=>Number(x.revenue||0)));
    if($('financeChart')) $('financeChart').innerHTML=vals.length?vals.map(x=>'<div class="financeBar" title="'+esc(x.day)+' • '+brl(x.revenue)+'" style="height:'+Math.max(3,Number(x.revenue||0)/max*100)+'%"></div>').join(''):'<div class="empty">Sem faturamento neste período.</div>';
    if($('financeRows')) $('financeRows').innerHTML=(d.payments||[]).map(p=>'<tr><td>'+date(p.dateApproved||p.dateCreated)+'</td><td>'+esc(p.id)+'</td><td>'+esc(p.description||'—')+'</td><td>'+esc(p.method||'—')+'</td><td>'+esc(p.status||'—')+'</td><td>'+brl(p.amount)+'</td></tr>').join('')||'<tr><td colspan="6"><div class="empty">Nenhum pagamento encontrado.</div></td></tr>';
  }catch(e){
    if($('financeRows')) $('financeRows').innerHTML='<tr><td colspan="6"><div class="empty danger">Financeiro: '+esc(e.message)+'</div></td></tr>';
  }
}

function predictionText(ev){
  if(ev.active)return '<span class="ok">Evento ativo agora</span>';
  if(ev.nextEstimate){
    const d=new Date(ev.nextEstimate);
    if(!isNaN(d.getTime())){
      const diff=d.getTime()-Date.now();
      const mins=Math.round(diff/60000);
      const rel=mins>0?(mins<60?'em ~'+mins+' min':'em ~'+Math.round(mins/60*10)/10+' h'):'janela estimada atingida';
      return '<span class="ok">Próximo estimado: '+d.toLocaleString('pt-BR')+' ('+rel+')</span>';
    }
  }
  return '<span class="subtitle">Próximo: aguardando histórico suficiente do servidor</span>';
}

async function stableEvents(){
  if(!$('eventsGrid'))return;
  try{
    const d=await json('/api/admin/server/events');
    $('eventsGrid').innerHTML=(d.events||[]).map(x=>'<div class="event"><b>'+esc(x.label)+'</b><div class="status '+(x.active?'online':'offline')+'">● '+(x.active?'ATIVO':'INATIVO')+'</div><div class="subtitle">Última detecção: '+date(x.lastSeen)+'</div><div style="margin-top:8px">'+predictionText(x)+'</div>'+(x.averageIntervalMinutes?'<div class="subtitle">Média observada: ~'+esc(x.averageIntervalMinutes)+' min • '+esc(x.detections)+' detecções</div>':'')+'</div>').join('')||'<div class="empty">Nenhum evento monitorado.</div>';
  }catch(e){$('eventsGrid').innerHTML='<div class="empty danger">Eventos: '+esc(e.message)+'</div>'}
}

async function stableChat(){
  const box=$('chatBox');if(!box)return;
  try{
    const d=await json('/api/admin/server/chat');
    const rows=d.messages||[];
    box.innerHTML=rows.length?rows.map(m=>'<div class="chatMsg '+(m.type==='moderation'?'mod':'')+'"><b>'+esc(m.player||'Jogador')+'</b><small>'+date(m.at)+'</small><div>'+esc(m.message||'')+'</div></div>').join(''):'<div class="empty">Nenhuma mensagem capturada ainda. O painel está aguardando mensagens do WebRCON.</div>';
    box.scrollTop=box.scrollHeight;
  }catch(e){box.innerHTML='<div class="empty danger">Chat: '+esc(e.message)+'</div>'}
}

function bind(){
  removeLegacyPlayerActions();addVersion();
  $('financeDays')?.addEventListener('change',stableFinance);
  $('refreshEvents')?.addEventListener('click',stableEvents);
  $('refreshChat')?.addEventListener('click',stableChat);
  document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>{
    const id=b.dataset.view;
    setTimeout(()=>{if(id==='finance')stableFinance();if(id==='events')stableEvents();if(id==='chat')stableChat();if(id==='players')removeLegacyPlayerActions()},40);
  }));
}

function start(){bind();removeLegacyPlayerActions();setTimeout(removeLegacyPlayerActions,600);}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
setInterval(()=>{if($('chat')?.classList.contains('active'))stableChat()},2000);
setInterval(()=>{if($('events')?.classList.contains('active'))stableEvents()},30000);
})();
`;

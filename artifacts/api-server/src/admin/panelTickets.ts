export const panelTicketsHtml = `<section id="tickets" class="view"><div class="section"><div class="sectionHead"><div><h2>🎟️ Tickets do Discord</h2><div class="subtitle">Atendimento diretamente pelo painel administrativo</div></div><button id="ticketsReload" class="btn">Atualizar</button></div><div class="body" style="display:grid;grid-template-columns:minmax(170px,30%) 1fr;gap:12px"><div><input id="ticketsSearch" placeholder="Buscar ticket"/><div id="ticketsList" style="overflow-y:auto;max-height:600px;margin-top:9px"></div></div><div style="min-width:0"><div id="ticketsTitle" class="subtitle">Selecione um ticket</div><div id="ticketsMessages" class="chatBox" style="height:440px;margin:10px 0;border:1px solid var(--line);border-radius:12px"></div><div class="composer"><textarea id="ticketsReply" maxlength="1800" placeholder="Responder ao jogador..."></textarea><button id="ticketsSend" class="btn yellow">Responder</button></div></div></div></div></section>`;
export const panelTicketsJs = String.raw`
(function(){
'use strict';
const byId=id=>document.getElementById(id);
let current=null, tickets=[], busy=false, lastView=false;
const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function request(url,options){const r=await fetch(url,options);const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(data.error||'Erro HTTP '+r.status);return data;}
function showError(e){byId('ticketsTitle').textContent=e.message||String(e);}
function isActive(){return byId('tickets')?.classList.contains('active');}
function ensureNav(){
 for(const navId of ['nav','mobileNav']){
  const nav=byId(navId);if(!nav||nav.querySelector('[data-view="tickets"]')||!nav.children.length)return;
  const b=document.createElement('button');b.textContent='🎟️ Tickets';b.dataset.view='tickets';
  b.addEventListener('click',()=>{document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));byId('tickets').classList.add('active');byId('pageTitle').textContent='Tickets';document.querySelectorAll('[data-view]').forEach(x=>x.classList.toggle('active',x.dataset.view==='tickets'));loadTickets();});
  nav.appendChild(b);
 }
}
function list(){
 const q=byId('ticketsSearch').value.trim().toLowerCase();
 byId('ticketsList').innerHTML=tickets.filter(t=>(t.name+' '+(t.topic||'')).toLowerCase().includes(q)).map(t=>'<button class="btn" data-ticket="'+t.id+'" style="display:block;text-align:left;width:100%;margin:4px 0;overflow-wrap:anywhere;'+(t.id===current?'border-color:var(--yellow)':'')+'">'+escapeHtml(t.name)+'</button>').join('')||'<div class="empty">Nenhum ticket encontrado.</div>';
 byId('ticketsList').querySelectorAll('[data-ticket]').forEach(b=>b.onclick=()=>{current=b.dataset.ticket;list();loadMessages();});
}
async function loadTickets(){
 if(busy)return;busy=true;
 try{const d=await request('/api/admin/tickets');tickets=d.tickets||[];if(current&&!tickets.some(t=>t.id===current))current=null;list();if(current)await loadMessages();}
 catch(e){showError(e);byId('ticketsList').textContent='Falha ao carregar tickets.';}
 finally{busy=false;}
}
async function loadMessages(){
 if(!current)return;
 const id=current;try{
  const data=await request('/api/admin/tickets/'+id+'/messages');if(current!==id)return;
  const t=tickets.find(x=>x.id===id);byId('ticketsTitle').textContent=t?.name||id;
  byId('ticketsMessages').innerHTML=(data.messages||[]).map(m=>'<div class="chatLine"><div class="chatBubble"><div class="chatHead"><span class="chatName">'+escapeHtml(m.author)+'</span><span class="chatTime">'+new Date(m.createdAt).toLocaleString('pt-BR')+'</span></div><div class="chatText" style="white-space:pre-wrap">'+escapeHtml(m.content||'')+'</div>'+((m.attachments||[]).map(a=>'<div><a target="_blank" rel="noopener noreferrer" href="'+encodeURI(a.url)+'">'+escapeHtml(a.name||'Anexo')+'</a></div>').join(''))+'</div></div>').join('')||'<div class="empty">Sem mensagens recentes.</div>';
  byId('ticketsMessages').scrollTop=byId('ticketsMessages').scrollHeight;
 }catch(e){showError(e);}
}
async function reply(){
 if(!current)return showError(new Error('Selecione um ticket.'));
 const field=byId('ticketsReply'),content=field.value.trim();if(!content)return;
 const b=byId('ticketsSend');b.disabled=true;
 try{await request('/api/admin/tickets/'+current+'/reply',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content})});field.value='';await loadMessages();}
 catch(e){showError(e);}finally{b.disabled=false;}
}
function start(){
 ensureNav();
 byId('ticketsReload').onclick=loadTickets;
 byId('ticketsSearch').oninput=list;
 byId('ticketsSend').onclick=reply;
 document.addEventListener('click',event=>{const b=event.target.closest('[data-view]');if(b&&b.dataset.view!=='tickets')byId('tickets').classList.remove('active');});
 setInterval(()=>{ensureNav();const visible=isActive()&&!document.hidden;if(visible&&!lastView)loadTickets();lastView=visible;},800);
 setInterval(()=>{if(isActive()&&!document.hidden)loadTickets();},7000);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
`;

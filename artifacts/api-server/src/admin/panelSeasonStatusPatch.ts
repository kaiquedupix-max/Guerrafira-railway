export const panelSeasonStatusPatchJs = String.raw`
(function(){'use strict';
let resetBusy=false;

async function fallbackResetSeason(){
  if(resetBusy)return;
  const typed=prompt('ATENÇÃO: isso apaga TODA a pontuação e histórico de MMR da Season 1, mas preserva os inscritos.\\n\\nDigite ZERAR para confirmar:');
  if(String(typed||'').trim().toUpperCase()!=='ZERAR')return;
  const msg=document.getElementById('seasonControlMsg');
  resetBusy=true;
  const btn=document.getElementById('seasonResetAll');
  if(btn)btn.disabled=true;
  try{
    if(msg)msg.textContent='Zerando pontuação no banco... não feche esta tela.';
    const r=await fetch('/api/admin/season/control/reset',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({confirm:'ZERAR'}),
      cache:'no-store'
    });
    const d=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(d.error||('Falha no reset (HTTP '+r.status+')'));
    if(msg)msg.textContent='✅ '+(d.message||'Season zerada.');
    if(typeof window.loadControl==='function')await window.loadControl();
    if(typeof window.load==='function')await window.load();
    setTimeout(()=>location.reload(),700);
  }catch(e){
    if(msg)msg.textContent='❌ '+(e&&e.message?e.message:'Falha ao zerar a Season.');
  }finally{
    resetBusy=false;
    if(btn)btn.disabled=false;
  }
}

function bindResetFallback(){
  const btn=document.getElementById('seasonResetAll');
  if(!btn||btn.dataset.resetFallbackBound==='1')return;
  // O addon principal deveria preencher onclick. Em alguns renders mobile a view já existe
  // antes do ensureView(), então ele retorna cedo e o botão fica visualmente ativo sem handler.
  if(typeof btn.onclick!=='function'){
    btn.addEventListener('click',fallbackResetSeason);
    btn.dataset.resetFallbackBound='1';
  }
}

function patch(){
  bindResetFallback();
  const rows=document.querySelectorAll('#seasonRows tr');
  rows.forEach(tr=>{
    const td=tr.querySelectorAll('td');
    if(td.length<5)return;
    const steam=String(td[2]?.textContent||'').trim();
    const player=String(td[3]?.textContent||'').trim();
    const rank=String(td[4]?.textContent||'').trim();
    const hasSteam=/^7656119\\d{10}$/.test(steam);
    if(!hasSteam)return;
    if(player==='Aguardando dados') td[3].textContent='Steam confirmada • aguardando 1ª atividade';
    if(rank==='Aguardando dados'){
      const badge=td[4].querySelector('.badge');
      if(badge) badge.textContent='Aguardando 1ª atividade';
      else td[4].textContent='Aguardando 1ª atividade';
    }
  });
}
new MutationObserver(patch).observe(document.documentElement,{childList:true,subtree:true});
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',patch);else patch();
setInterval(patch,1500);
})();`;
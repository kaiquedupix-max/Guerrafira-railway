export const panelSeasonStatusPatchJs = String.raw`
(function(){'use strict';
function patch(){
  const rows=document.querySelectorAll('#seasonRows tr');
  rows.forEach(tr=>{
    const td=tr.querySelectorAll('td');
    if(td.length<5)return;
    const steam=String(td[2]?.textContent||'').trim();
    const player=String(td[3]?.textContent||'').trim();
    const rank=String(td[4]?.textContent||'').trim();
    const hasSteam=/^7656119\d{10}$/.test(steam);
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

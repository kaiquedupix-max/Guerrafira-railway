export const panelV5PolishJs = String.raw`
(function(){
'use strict';
let financeAllowed=null;
function removeServer(){document.getElementById('server')?.remove();document.querySelectorAll('[data-view="server"]').forEach(x=>x.remove())}
function lockFinance(){const f=document.getElementById('finance');if(!f)return;f.innerHTML='<div class="section financeLocked"><div class="body"><div class="lockIcon">🔒</div><h2>Financeiro restrito</h2><p>Você não tem permissão para visualizar os dados financeiros.</p><small>Somente membros com permissão de Administrador no Discord do Guerra Fria podem acessar esta área.</small></div></div>'}
async function capabilities(){try{const r=await fetch('/api/admin/me');if(!r.ok)return;const d=await r.json();financeAllowed=!!d.capabilities?.canViewFinance;if(!financeAllowed)lockFinance()}catch{}}
document.addEventListener('click',function(e){const b=e.target.closest&&e.target.closest('[data-view="finance"]');if(!b||financeAllowed!==false)return;e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));document.getElementById('finance')?.classList.add('active');document.querySelectorAll('[data-view]').forEach(x=>x.classList.toggle('active',x.dataset.view==='finance'));const t=document.getElementById('pageTitle');if(t)t.textContent='Financeiro';lockFinance()},true);
const css=document.createElement('style');
css.textContent='\
.financeLocked{text-align:center}.financeLocked .body{padding:48px 20px}.financeLocked h2{margin:8px 0}.financeLocked p,.financeLocked small{color:#968ba3}.lockIcon{font-size:42px}\
@media(max-width:560px){\
.main{padding:8px 9px 74px!important}.mobileNav{padding:6px 0!important;gap:5px!important}.mobileNav button{padding:8px 10px!important;font-size:11px!important}.top{margin:7px 0 10px!important;align-items:center!important}.top h1{font-size:24px!important}.top .subtitle{display:none}.version{font-size:9px!important}.cards{grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:6px!important}.card{min-height:78px!important;padding:10px!important;border-radius:13px!important}.card small{font-size:7px!important;letter-spacing:.08em!important}.card strong{font-size:20px!important;margin-top:7px!important}.section{margin-top:9px!important;border-radius:13px!important}.sectionHead{padding:10px 12px!important;gap:7px!important}.sectionHead h2{font-size:15px!important}.body{padding:11px!important}.table td{padding:9px!important}.table th{padding:9px!important}.table{min-width:620px!important}.chatBox{height:58vh!important;padding:9px!important}.chatLine{margin-bottom:8px!important}.avatar{width:31px!important;height:31px!important;flex-basis:31px!important;font-size:12px!important}.drawer{padding:12px!important}.drawerHead{top:-12px!important;padding:12px 0 8px!important}.actionGrid{gap:6px!important}.stateCard{padding:9px!important}#overview .section{max-height:285px;overflow:hidden}#overviewLogs tr:nth-child(n+7){display:none}\
}';
document.head.appendChild(css);
function apply(){removeServer();if(financeAllowed===false)lockFinance()}
const obs=new MutationObserver(apply);obs.observe(document.documentElement,{childList:true,subtree:true});
setTimeout(()=>{apply();capabilities()},80);setTimeout(apply,600);setTimeout(apply,1800);
})();
`;

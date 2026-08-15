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

// Camada visual única: tokens, hierarquia, estados e acessibilidade para todas as telas.
const professional=document.createElement('style');
professional.textContent=String.raw`
:root{--gf-bg:#08060d;--gf-surface:#120d1b;--gf-surface-2:#1a1226;--gf-border:rgba(185,122,255,.22);--gf-border-strong:rgba(185,122,255,.46);--gf-text:#f7f3fb;--gf-muted:#a99db5;--gf-primary:#a855f7;--gf-primary-2:#7c3aed;--gf-success:#22c55e;--gf-danger:#fb4968;--gf-warning:#f59e0b;--gf-radius:18px;--gf-shadow:0 18px 55px rgba(0,0,0,.34)}
html{background:var(--gf-bg);color-scheme:dark}body{background:radial-gradient(1000px 540px at 12% -10%,rgba(124,58,237,.16),transparent 60%),var(--gf-bg);color:var(--gf-text);letter-spacing:-.01em}
.main{max-width:1500px;margin:auto}.top{padding:8px 2px 16px}.top h1{letter-spacing:-.035em}.top .subtitle{color:var(--gf-muted)}
.section,.card,.drawer,.stateCard{background:linear-gradient(145deg,rgba(26,18,38,.97),rgba(13,9,20,.98));border:1px solid var(--gf-border);box-shadow:var(--gf-shadow);backdrop-filter:blur(16px)}
.section{overflow:hidden;border-radius:var(--gf-radius)}.sectionHead{border-bottom:1px solid rgba(255,255,255,.06);background:rgba(255,255,255,.018)}.sectionHead h2{font-weight:760;letter-spacing:-.02em}
.card{position:relative;overflow:hidden;transition:transform .18s ease,border-color .18s ease,box-shadow .18s ease}.card:before{content:"";position:absolute;inset:0 0 auto;height:2px;background:linear-gradient(90deg,transparent,var(--gf-primary),transparent);opacity:.48}.card:hover{transform:translateY(-2px);border-color:var(--gf-border-strong);box-shadow:0 22px 60px rgba(0,0,0,.42)}
button,.btn,input,select,textarea{border-radius:12px!important;transition:border-color .16s ease,background .16s ease,transform .16s ease,box-shadow .16s ease}button,.btn{font-weight:700;min-height:40px}button:hover,.btn:hover{transform:translateY(-1px)}button:focus-visible,.btn:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{outline:2px solid rgba(168,85,247,.65);outline-offset:2px}
input,select,textarea{background:#0d0913!important;border:1px solid var(--gf-border)!important;color:var(--gf-text)!important}input::placeholder,textarea::placeholder{color:#756b80}input:focus,select:focus,textarea:focus{border-color:var(--gf-primary)!important;box-shadow:0 0 0 3px rgba(168,85,247,.12)}
.table{border-collapse:separate;border-spacing:0}.table th{position:sticky;top:0;z-index:2;background:#130e1c;color:#b9adc5;text-transform:uppercase;font-size:10px;letter-spacing:.09em}.table td{border-top:1px solid rgba(255,255,255,.045)}.table tr{transition:background .15s ease}.table tbody tr:hover{background:rgba(168,85,247,.055)}
.badge,.pill,.status{border:1px solid rgba(255,255,255,.1);box-shadow:inset 0 1px rgba(255,255,255,.05)}.empty,.muted{color:var(--gf-muted)}
.drawer{border-left-color:var(--gf-border-strong)}.drawerHead{background:linear-gradient(180deg,#181020 82%,transparent)}
.mobileNav{background:rgba(9,6,13,.9)!important;border:1px solid var(--gf-border)!important;box-shadow:0 -12px 45px rgba(0,0,0,.42);backdrop-filter:blur(20px)}
[data-view].active{color:#fff!important;background:linear-gradient(135deg,rgba(168,85,247,.26),rgba(124,58,237,.13))!important}
@media(max-width:760px){body{font-size:14px}.main{padding-left:10px!important;padding-right:10px!important}.sectionHead{align-items:flex-start;flex-wrap:wrap}.body{overflow-x:auto}.cards{gap:10px!important}.card{min-height:92px!important}.drawer{width:100%!important}.table{font-size:12px}.mobileNav{padding-bottom:max(8px,env(safe-area-inset-bottom))!important}}
@media(prefers-reduced-motion:reduce){*,*:before,*:after{scroll-behavior:auto!important;transition:none!important;animation:none!important}}
`;
document.head.appendChild(professional);

function apply(){removeServer();if(financeAllowed===false)lockFinance()}
const obs=new MutationObserver(apply);obs.observe(document.documentElement,{childList:true,subtree:true});
setTimeout(()=>{apply();capabilities()},80);setTimeout(apply,600);setTimeout(apply,1800);
})();
`;

export const panelProfessionalJs = String.raw`
(function(){
  'use strict';
  const css=document.createElement('style');
  css.textContent='\
:root{--gf-gold:#f5c451;--gf-gold-soft:#f5c45122;--gf-surface:#100b17;--gf-surface-2:#171020;--gf-border:#3c2a50}\
html{scroll-behavior:smooth}body{background:radial-gradient(circle at 75% 0,#2a123b55 0,transparent 34rem),#060409!important}\
.main{width:100%;max-width:1600px;margin:0 auto;padding-top:30px!important}.top{align-items:center!important;margin-bottom:24px!important}.top h1{font-size:clamp(30px,4vw,46px)!important;letter-spacing:-.045em}.subtitle{line-height:1.5}\
.section,.card,.financeHero{border-color:var(--gf-border)!important;box-shadow:0 18px 50px #0003;background:linear-gradient(145deg,#15101d,#0c0911)!important}.section{border-radius:22px!important}.card{border-radius:20px!important;transition:transform .2s,border-color .2s,box-shadow .2s}.card.click:hover{transform:translateY(-3px);border-color:#74509a!important;box-shadow:0 20px 45px #0006}.card strong{letter-spacing:-.035em}.sectionHead{padding:20px 22px!important}.body{padding:22px!important}\
.gfHero{position:relative;min-height:clamp(260px,35vw,500px);margin-bottom:20px;border:1px solid #72502b;border-radius:26px;overflow:hidden;isolation:isolate;background:#080608;box-shadow:0 30px 80px #0009}.gfHero img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:-2}.gfHero:after{content:"";position:absolute;inset:0;background:linear-gradient(90deg,#050307dd 0,#05030777 48%,#05030722),linear-gradient(0deg,#07040cdd 0,transparent 55%);z-index:-1}.gfHeroContent{position:absolute;left:clamp(22px,5vw,64px);bottom:clamp(22px,5vw,58px);max-width:560px}.gfHeroEyebrow{color:var(--gf-gold);font-size:11px;font-weight:950;letter-spacing:.2em;text-transform:uppercase}.gfHero h2{margin:8px 0 8px;font-size:clamp(34px,7vw,72px);line-height:.95;letter-spacing:-.05em;text-shadow:0 5px 30px #000}.gfHero p{margin:0;color:#e8decd;font-size:clamp(13px,2vw,18px);font-weight:750}.gfHeroBadge{display:inline-flex;margin-top:16px;padding:9px 13px;border:1px solid #d89f45;border-radius:999px;background:#1a1009cc;color:#ffd57b;font-weight:900;font-size:12px}\
.financeHero{padding:clamp(20px,4vw,34px)!important;border-radius:24px!important}.financeHeroTop h2{font-size:clamp(27px,4vw,40px)!important}.financeCards{gap:14px!important}.financeMetric{border-radius:19px!important;background:linear-gradient(145deg,#0b0810,#100b16)!important}.financeMetric strong{font-size:clamp(24px,4vw,38px)!important}.financeTable tr:hover td{background:#171020}.btn{min-height:42px;transition:transform .15s,filter .15s}.btn:hover{filter:brightness(1.12);transform:translateY(-1px)}input,select,textarea{min-height:44px;border-radius:13px!important}.tableWrap{scrollbar-width:thin;scrollbar-color:#51376b #0b0810}\
@media(max-width:980px){.main{padding-top:16px!important}.top{margin-bottom:16px!important}.gfHero{min-height:340px;border-radius:21px}.cards{gap:10px!important}.section{border-radius:19px!important}.financeCards{grid-template-columns:repeat(2,minmax(0,1fr))!important}}\
@media(max-width:560px){.main{padding-left:12px!important;padding-right:12px!important}.gfHero{min-height:310px}.gfHero:after{background:linear-gradient(0deg,#07040cf5 0,#07040c77 70%,#05030733)}.gfHeroContent{left:20px;right:20px;bottom:20px}.financeHero{padding:18px!important}.financeHeroTop{align-items:stretch!important;flex-direction:column!important}.financeHeroTop select{width:100%!important}.financeCards{grid-template-columns:1fr!important}.financeMetric{min-height:122px!important}.sectionHead{padding:17px!important}.body{padding:16px!important}.cards .card{min-height:112px!important}.table td,.table th{padding:11px!important}}';
  document.head.appendChild(css);

  function enhance(){
    const misplaced=document.getElementById('gfHero');if(misplaced)misplaced.remove();
    const chart=document.getElementById('financeChart');
    const section=chart&&chart.closest('.section');if(section)section.style.display='none';
  }

  const nativeFetch=window.fetch.bind(window);
  window.fetch=async function(input,init){
    const response=await nativeFetch(input,init);
    try{
      const url=typeof input==='string'?input:(input&&input.url)||'';
      if(url.includes('/api/admin/finance/live')){
        const data=await response.clone().json();
        setTimeout(function(){
          if(data.report&&data.report.status!=='ready'){
            const value=document.getElementById('finExpenses');if(value)value.textContent=data.report.status==='processing'?'Atualizando…':'Indisponível';
            const summary=document.getElementById('finSummary');if(summary)summary.textContent=data.report.status==='processing'?'O Mercado Pago está preparando o extrato completo de entradas e saídas.':'Extrato completo indisponível: tente novamente em instantes.';
          }
        },0);
      }
    }catch{}
    return response;
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',enhance);else enhance();
  new MutationObserver(enhance).observe(document.documentElement,{childList:true,subtree:true});
})();
`;

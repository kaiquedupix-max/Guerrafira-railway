export const panelFinanceLabelsJs = String.raw`
(function(){
  'use strict';
  const money=v=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  const byId=id=>document.getElementById(id);
  const setLabel=(id,text)=>{const el=byId(id),card=el&&el.closest('.financeMetric'),label=card&&card.querySelector('small');if(label)label.textContent=text};

  function applyLabels(){
    setLabel('finBalance','Faturamento total do servidor');
    setLabel('finGross','Faturamento do período');
    setLabel('finNet','Receita de VIPs');
    setLabel('finExpenses','Ticket médio');
    setLabel('finDeductions','VIPs vendidos no período');
    setLabel('finFlow','Total do período');
    const subtitle=document.querySelector('#finance .financeHero .subtitle');
    if(subtitle)subtitle.textContent='Histórico completo de vendas de VIP — ativos e expirados';
    const badge=document.querySelector('#finance .section .badge.green');
    if(badge&&badge.textContent.includes('Mercado Pago'))badge.textContent='Banco de dados ao vivo';
    const hint=document.querySelector('#finance .sectionHead .financeHint');
    if(hint)hint.textContent='Cada linha representa uma venda de VIP registrada no dia em que aconteceu, mesmo que o VIP já tenha expirado.';
  }

  applyLabels();
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',applyLabels);

  const nativeFetch=window.fetch.bind(window);
  window.fetch=async function(input,init){
    const response=await nativeFetch(input,init);
    try{
      const url=typeof input==='string'?input:(input&&input.url)||'';
      if(url.includes('/api/admin/finance/live')){
        const data=await response.clone().json();
        setTimeout(function(){
          applyLabels();
          const s=data.summary||{},a=data.account||{};
          if(byId('finBalance'))byId('finBalance').textContent=money(a.balance||s.lifetimeRevenue);
          if(byId('finGross'))byId('finGross').textContent=money(s.grossRevenue);
          if(byId('finNet'))byId('finNet').textContent=money(s.netRevenue);
          if(byId('finExpenses'))byId('finExpenses').textContent=money(s.avgTicket);
          if(byId('finDeductions'))byId('finDeductions').textContent=String(Number(s.approved||0));
          if(byId('finFlow'))byId('finFlow').textContent=money(s.cashFlow);
          if(byId('finSummary'))byId('finSummary').textContent=Number(s.approved||0)+' VIPs vendidos no período • '+Number(s.activeVips||0)+' ativos agora • total histórico '+money(s.lifetimeRevenue);
        },0);
      }
    }catch{}
    return response;
  };
})();`;
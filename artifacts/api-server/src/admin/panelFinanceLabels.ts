export const panelFinanceLabelsJs = String.raw`
(function(){
  const balance = document.getElementById('finBalance');
  const card = balance && balance.closest('.financeMetric');
  const label = card && card.querySelector('small');
  if (label) label.textContent = 'Saldo calculado (histórico)';
  const subtitle = document.querySelector('#finance .financeHero .subtitle');
  if (subtitle) subtitle.textContent = 'Entradas, saídas, taxas e saldo calculado do Mercado Pago';
})();`;

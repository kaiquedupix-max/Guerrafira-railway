export const panelFinanceLabelsJs = String.raw`
(function(){
  const balance = document.getElementById('finBalance');
  const card = balance && balance.closest('.financeMetric');
  const label = card && card.querySelector('small');
  if (label) label.textContent = 'Saldo calculado (histórico)';
  const subtitle = document.querySelector('#finance .financeHero .subtitle');
  if (subtitle) subtitle.textContent = 'Entradas, saídas, taxas e saldo calculado do Mercado Pago';

  // Segurança financeira da tabela: somente pagamentos aprovados podem
  // aparecer como entrada/saída efetiva. Rejeitados, cancelados, pendentes,
  // estornados etc. continuam visíveis para auditoria, mas com líquido zero.
  function normalizeFinanceRows(){
    const body = document.getElementById('financeRows');
    if (!body) return;
    body.querySelectorAll('tr').forEach(function(row){
      const cells = row.querySelectorAll('td');
      if (cells.length < 8) return;
      const status = String(cells[4].textContent || '').trim().toLowerCase();
      if (status === 'approved') return;
      const amount = cells[7];
      amount.textContent = 'R$ 0,00';
      amount.classList.remove('in','out');
      amount.style.color = '#a89daf';
    });
  }

  const financeRows = document.getElementById('financeRows');
  if (financeRows) {
    new MutationObserver(normalizeFinanceRows).observe(financeRows, { childList: true, subtree: true });
    normalizeFinanceRows();
  }
})();`;

export const panelFinanceRepairJs = String.raw`
(function(){
  'use strict';

  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c] || c));
  const money = (value) => {
    const n = Number(value);
    return (Number.isFinite(n) ? n : 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  };
  const fmt = (value) => {
    if (!value) return '—';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('pt-BR');
  };

  let lastData = null;

  function renderFinance(data){
    if (!data || typeof data !== 'object') return;
    lastData = data;

    const summary = data.summary || {};
    const account = data.account || {};
    const balance = Number(account.balance);

    if ($('finBalance')) $('finBalance').textContent = Number.isFinite(balance) ? money(balance) : 'Indisponível';
    if ($('finGross')) $('finGross').textContent = money(summary.grossRevenue);
    if ($('finNet')) $('finNet').textContent = money(summary.netRevenue);
    if ($('finExpenses')) $('finExpenses').textContent = money(summary.expenses);
    if ($('finDeductions')) $('finDeductions').textContent = money(Number(summary.fees || 0) + Number(summary.refunded || 0));
    if ($('finFlow')) {
      $('finFlow').textContent = money(summary.cashFlow);
      $('finFlow').style.color = Number(summary.cashFlow || 0) >= 0 ? '#ffd84d' : '#ff7c86';
    }

    if ($('finSummary')) {
      const reportStatus = String(data.report?.status || '');
      const base = String(Number(summary.approved || 0)) + ' entradas • ' + String(Number(summary.outgoings || 0)) + ' saídas • ticket médio ' + money(summary.avgTicket);
      $('finSummary').textContent = reportStatus === 'processing' ? base + ' • extrato completo atualizando' : base;
    }

    const rows = Array.isArray(data.payments) ? data.payments.slice(0, 500) : [];
    if ($('financeRows')) {
      $('financeRows').innerHTML = rows.length ? rows.map((p) => {
        const approved = String(p.status || '').toLowerCase() === 'approved';
        const dir = p.direction === 'out' ? 'out' : 'in';
        const rawSigned = dir === 'out' ? -Math.abs(Number(p.signedAmount || p.amount || 0)) : Number(p.signedAmount || p.netAmount || p.amount || 0);
        const signed = approved ? rawSigned : 0;
        const movementClass = approved ? dir : '';
        const movementLabel = p.direction === 'out' ? '↓ Saída' : p.direction === 'in' ? '↑ Entrada' : 'Movimentação';
        const amountClass = approved ? ('amount ' + dir) : 'amount';
        const amountStyle = approved ? '' : ' style="color:#a89daf"';
        const amountPrefix = signed > 0 ? '+ ' : signed < 0 ? '- ' : '';
        return '<tr>' +
          '<td>' + fmt(p.dateApproved || p.dateCreated) + '</td>' +
          '<td><span class="movement ' + movementClass + '">' + movementLabel + '</span></td>' +
          '<td>' + esc(p.description || 'Movimentação') + '<div class="financeHint">#' + esc(p.id || '—') + '</div></td>' +
          '<td>' + esc(p.method || '—') + '</td>' +
          '<td>' + esc(p.status || '—') + '</td>' +
          '<td>' + money(p.grossAmount || p.amount) + '</td>' +
          '<td>' + money(Number(p.fees || 0) + Number(p.refunded || 0)) + '</td>' +
          '<td class="' + amountClass + '"' + amountStyle + '>' + amountPrefix + money(Math.abs(signed)) + '</td>' +
          '</tr>';
      }).join('') : '<tr><td colspan="8"><div class="empty">Nenhuma movimentação neste período.</div></td></tr>';
    }

    const trend = Array.isArray(data.trend) ? data.trend : [];
    if ($('financeChart')) {
      const max = Math.max(1, ...trend.flatMap((x) => [Number(x.entries || 0), Number(x.exits || 0)]));
      $('financeChart').innerHTML = trend.map((x) => {
        const ih = Math.max(x.entries ? 3 : 1, Math.round(Number(x.entries || 0) / max * 100));
        const oh = Math.max(x.exits ? 3 : 1, Math.round(Number(x.exits || 0) / max * 100));
        return '<div class="cashDay" title="' + esc(x.day) + ' • Entradas ' + money(x.entries) + ' • Saídas ' + money(x.exits) + '"><div class="cashHalf"><i class="cashBar in" style="height:' + ih + '%"></i></div><div class="cashHalf out"><i class="cashBar out" style="height:' + oh + '%"></i></div></div>';
      }).join('');
    }
  }

  function renderError(message){
    if ($('finSummary')) $('finSummary').textContent = 'Falha ao carregar Mercado Pago: ' + String(message || 'erro desconhecido');
    if ($('financeRows')) $('financeRows').innerHTML = '<tr><td colspan="8"><div class="empty danger">' + esc(message || 'Não foi possível carregar as movimentações.') + '</div></td></tr>';
  }

  const nativeFetch = window.fetch.bind(window);
  window.fetch = async function(input, init){
    const response = await nativeFetch(input, init);
    try {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      if (url.includes('/api/admin/finance/live')) {
        const clone = response.clone();
        if (response.ok) {
          clone.json().then(renderFinance).catch(() => renderError('Resposta inválida do Mercado Pago.'));
        } else {
          clone.json().then((body) => renderError(body?.error || ('Erro ' + response.status))).catch(() => renderError('Erro ' + response.status));
        }
      }
    } catch {}
    return response;
  };

  // Se outro complemento redesenhar o painel, reaplica o último snapshot financeiro.
  const finance = $('finance');
  if (finance) {
    new MutationObserver(() => {
      if (!lastData) return;
      const balance = $('finBalance');
      if (balance && (balance.textContent === '—' || balance.textContent === '')) renderFinance(lastData);
    }).observe(finance, { childList: true, subtree: true });
  }
})();
`;

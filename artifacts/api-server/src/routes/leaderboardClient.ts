export const leaderboardClientJs = String.raw`
(() => {
  'use strict';
  const el = id => document.getElementById(id);
  const ui = {
    players: el('p'), kills: el('k'), farm: el('f'), raid: el('r'),
    killLeader: el('lk'), raidLeader: el('lr'), updated: el('updated'),
    tabs: el('tabs'), categoryIcon: el('categoryIcon'), title: el('title'),
    subtitle: el('sub'), badge: el('badge'), podium: el('podium'),
    metric: el('metric'), rows: el('rows'), toggle: el('toggle')
  };
  const cdn = 'https://rustlabs.com/img/items180/';
  const categories = {
    kills: ['Top Kills', 'Kills', 'Os jogadores mais letais do wipe.', null],
    kd: ['K/D', 'K/D', 'Melhor relação entre kills e mortes.', null],
    hs: ['Top HS%', 'HS%', 'Mínimo de 10 kills.', null],
    headshots: ['Headshots', 'HS', 'Headshots confirmados.', null],
    raid: ['Top Raid', 'Raid', 'C4 + rockets utilizados.', cdn + 'ammo.rocket.basic.png'],
    c4: ['C4 Usados', 'C4', 'C4 utilizados.', cdn + 'explosive.timed.png'],
    rockets: ['Rockets', 'Rockets', 'Rockets disparados.', cdn + 'ammo.rocket.basic.png'],
    wood: ['Madeira', 'Madeira', 'Madeira coletada.', cdn + 'wood.png'],
    stone: ['Pedra', 'Pedra', 'Pedra coletada.', cdn + 'stones.png'],
    metal: ['Metal', 'Metal', 'Minério de metal coletado.', cdn + 'metal.ore.png'],
    sulfur: ['Enxofre', 'Enxofre', 'Minério de enxofre coletado.', cdn + 'sulfur.ore.png'],
    scrap: ['Sucata', 'Sucata', 'Sucata coletada durante o wipe.', cdn + 'scrap.png'],
    gunpowder: ['Pólvora', 'Pólvora', 'Pólvora craftada.', cdn + 'gunpowder.png'],
    explosives: ['Explosivos', 'Explosivos', 'Explosivos craftados.', cdn + 'explosives.png'],
    farm: ['Farm Total', 'Recursos', 'Madeira + pedra + metal + enxofre + sucata.', cdn + 'wood.png'],
    deaths: ['Mortes', 'Mortes', 'Mortes registradas.', null]
  };
  let payload = null;
  let current = 'kills';
  let expanded = false;
  const number = value => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(Number(value) || 0);
  const escape = value => String(value == null ? '' : value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const itemIcon = (url, className = 'itemIcon') => url ? '<img class="' + className + '" src="' + url + '" alt="" onerror="this.style.display=\'none\'">' : '';

  function buildTabs() {
    if (!ui.tabs) return;
    ui.tabs.innerHTML = '';
    Object.entries(categories).forEach(([key, meta]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'tab' + (key === current ? ' active' : '');
      button.dataset.k = key;
      button.innerHTML = itemIcon(meta[3], '') + '<span>' + meta[0] + '</span>';
      button.addEventListener('click', () => { current = key; expanded = false; render(); });
      ui.tabs.appendChild(button);
    });
  }

  function render() {
    if (!payload) return;
    const meta = categories[current];
    const all = Array.isArray(payload.categories && payload.categories[current]) ? payload.categories[current] : [];
    const visible = expanded ? all : all.slice(0, 10);
    ui.title.textContent = meta[0];
    ui.subtitle.textContent = meta[2];
    ui.badge.textContent = meta[1];
    ui.metric.textContent = meta[1];
    ui.categoryIcon.src = meta[3] || '';
    ui.categoryIcon.style.display = meta[3] ? 'block' : 'none';
    buildTabs();
    const medals = ['🥇', '🥈', '🥉'];
    ui.podium.innerHTML = [0, 1, 2].map(index => {
      const row = all[index];
      if (!row) return '';
      return '<article class="pod ' + (index === 0 ? 'first' : '') + '">' + itemIcon(meta[3]) +
        '<div class="rank">#' + (index + 1) + ' DO SERVIDOR</div><div class="medal">' + medals[index] +
        '</div><div class="name">' + escape(row.playerName) + '</div><div class="value">' + number(row.value) +
        (current === 'hs' ? '%' : '') + '</div>' + (row.secondary ? '<div class="mut">' + escape(row.secondary) + '</div>' : '') + '</article>';
    }).join('');
    ui.rows.innerHTML = visible.length ? visible.map((row, index) =>
      '<div class="row"><div>#' + (index + 1) + '</div><div><strong>' + escape(row.playerName) +
      '</strong><div class="steam">' + escape(row.steamId.slice(0, 7) + '••••••' + row.steamId.slice(-4)) +
      '</div></div><div class="score">' + number(row.value) + (current === 'hs' ? '%' : '') +
      (row.secondary ? '<div class="mut">' + escape(row.secondary) + '</div>' : '') + '</div></div>'
    ).join('') : '<div class="empty">Ainda não há dados nessa categoria.</div>';
    ui.toggle.style.display = all.length > 10 ? 'inline-block' : 'none';
    ui.toggle.textContent = expanded ? 'Mostrar apenas Top 10' : 'Ver ranking completo (' + all.length + ' jogadores)';
  }

  async function load() {
    try {
      const response = await fetch('/api/leaderboard?ts=' + Date.now(), { cache: 'no-store', credentials: 'same-origin' });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const next = await response.json();
      if (!next || !next.summary || !next.categories) throw new Error('Resposta inválida');
      payload = next;
      const summary = next.summary;
      ui.players.textContent = number(summary.activePlayers);
      ui.kills.textContent = number(summary.totalKills);
      ui.farm.textContent = number(summary.totalFarm);
      ui.raid.textContent = number(summary.totalRaid);
      ui.killLeader.textContent = summary.leader || '—';
      ui.raidLeader.textContent = summary.raidLeader || '—';
      ui.updated.textContent = 'ATUALIZADO ' + new Date(next.updatedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      render();
    } catch (error) {
      console.error('Falha ao carregar leaderboard', error);
      ui.rows.innerHTML = '<div class="empty">Erro ao carregar ranking. Atualize a página em alguns segundos.</div>';
    }
  }

  ui.toggle.addEventListener('click', () => { expanded = !expanded; render(); });
  buildTabs();
  load();
  window.setInterval(load, 60000);
})();
`;

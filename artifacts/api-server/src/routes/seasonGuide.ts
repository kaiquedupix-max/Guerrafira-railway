export function renderSeasonGuide(seasonNumber: number): string {
  const n = Math.max(1, Math.trunc(Number(seasonNumber) || 1));
  return `<!doctype html>
<html lang="pt-BR"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#08090b">
<title>Guia da Season ${n} • Guerra Fria</title>
<style>
:root{--bg:#08090b;--panel:#101216;--line:#2a2f38;--text:#f5f5f4;--muted:#9ca3af;--red:#ef4444;--gold:#f59e0b;--green:#4ade80}
*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 50% -10%,#35130f,#111318 38%,#08090b 70%);color:var(--text);font-family:Inter,system-ui,-apple-system,sans-serif;line-height:1.6}.wrap{width:min(980px,calc(100% - 24px));margin:auto}.top{position:sticky;top:0;background:#08090bee;backdrop-filter:blur(14px);border-bottom:1px solid #ffffff10;z-index:20}.topin{min-height:68px;display:flex;align-items:center;justify-content:space-between}.brand{font-weight:950}.back{color:#fff;text-decoration:none;border:1px solid var(--line);border-radius:10px;padding:9px 12px;font-size:12px;font-weight:850}.hero{text-align:center;padding:54px 0 24px}.ey{font-size:11px;font-weight:950;letter-spacing:.18em;color:#fca5a5;text-transform:uppercase}.hero h1{font-size:clamp(38px,8vw,68px);line-height:.95;margin:10px 0}.hero h1 span{color:var(--red)}.hero p{max-width:760px;margin:14px auto;color:var(--muted)}.section{background:#0b0d11e8;border:1px solid var(--line);border-radius:18px;margin:14px 0;overflow:hidden}.section h2{margin:0;padding:18px;border-bottom:1px solid var(--line);font-size:18px}.body{padding:18px;color:#c7cbd1}.ranks{display:grid;grid-template-columns:repeat(5,1fr);gap:8px}.rank{border:1px solid var(--line);background:#11141a;border-radius:13px;padding:14px;text-align:center}.rank strong{display:block;color:white}.rank span{font-size:10px;color:var(--muted)}.rank.max{border-color:#a16207;background:#211807}.actions{display:grid;grid-template-columns:repeat(2,1fr);gap:9px}.action{border:1px solid var(--line);background:#11141a;border-radius:12px;padding:13px}.action b{display:block;color:white}.action small{color:var(--muted)}.notice{border:1px solid #7f1d1d;background:#2b1012;border-radius:15px;padding:16px;margin:16px 0;color:#fecaca}.good{border-color:#166534;background:#0d2114;color:#bbf7d0}.foot{text-align:center;color:#596275;font-size:11px;padding:35px 0}@media(max-width:720px){.ranks{grid-template-columns:1fr}.actions{grid-template-columns:1fr}.hero{padding-top:36px}}
</style></head>
<body><header class="top"><div class="wrap topin"><div class="brand">GF • GUIA DA SEASON</div><a class="back" href="/season${n}">← Season ${n}</a></div></header>
<main class="wrap">
<section class="hero"><div class="ey">Season Premiada • Sistema de Patentes</div><h1>PATENTES <span>POR MMR</span></h1><p>A classificação pública mostra sua patente, não o seu MMR. O servidor usa o MMR internamente para calcular a progressão e ordenar os jogadores.</p></section>
<div class="notice"><strong>Importante:</strong> o valor de MMR de jogadores comuns e o valor exato de cada ação ficam ocultos. A página mostra quais ações contaram para a Season e se elas contribuíram positiva ou negativamente.</div>
<section class="section"><h2>🎖️ As 5 patentes</h2><div class="body"><div class="ranks">
<div class="rank"><strong>Recruta</strong><span>Entrada na Season</span></div>
<div class="rank"><strong>Soldado</strong><span>Progressão inicial</span></div>
<div class="rank"><strong>Capitão</strong><span>Faixa intermediária</span></div>
<div class="rank"><strong>Coronel</strong><span>Alta patente</span></div>
<div class="rank max"><strong>General de Guerra</strong><span>Patente máxima</span></div>
</div><p>As patentes são <strong>contabilizadas por MMR</strong>. O MMR considera desempenho em várias partes do Rust e é usado como mecanismo interno de balanceamento. Assim, um único estilo de jogo não precisa dominar toda a Season.</p></div></section>
<section class="section"><h2>⚔️ O que pode contar para subir</h2><div class="body"><div class="actions">
<div class="action"><b>PvP</b><small>Eliminações válidas, headshots e assistências, respeitando proteções e anti-farm.</small></div>
<div class="action"><b>Raid</b><small>Participação, defesa, estruturas destruídas e uso válido de explosivos.</small></div>
<div class="action"><b>Farm</b><small>Madeira, pedra, metal, enxofre e HQM.</small></div>
<div class="action"><b>Construção</b><small>Construção e evolução de estruturas da base.</small></div>
<div class="action"><b>Eventos</b><small>Bradley APC, Helicóptero de Patrulha e caixas hackeadas.</small></div>
<div class="action"><b>Outras ações válidas</b><small>Eventos reconhecidos pelo plugin e registrados no banco da Season.</small></div>
</div></div></section>
<section class="section"><h2>🧠 Por que o MMR fica oculto?</h2><div class="body"><p>O objetivo da página pública é mostrar <strong>posição, patente e histórico de ações</strong>, sem transformar cada atividade em uma tabela para farmar pontos. O cálculo continua sendo auditável pela administração, mas os pesos exatos não são publicados.</p><p>Quando um jogador alcança <strong>General de Guerra</strong>, a página passa a mostrar a <strong>Pontuação de General</strong>. Ela serve somente para comparar jogadores que já estão na patente máxima e explicar por que um General aparece acima do outro.</p></div></section>
<div class="notice good"><strong>Resumo:</strong> jogue Rust de forma completa. O servidor registra as ações, calcula o MMR internamente, converte esse resultado em patente e publica somente as informações necessárias para entender sua colocação.</div>
</main><footer class="foot">GUERRA FRIA RUST • Season ${n} • Patentes calculadas por MMR</footer></body></html>`;
}

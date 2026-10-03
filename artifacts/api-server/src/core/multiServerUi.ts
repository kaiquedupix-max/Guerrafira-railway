import type { Request } from "express";
import { trioReady, selectedServer } from "../routes/statusMultiServer.js";

function selectorHtml(current: "solo-duo" | "trio", basePath: string) {
  const ready = trioReady();
  const trioLabel = ready ? "TRIO" : "TRIO • EM BREVE";
  return `<div class="gfServerPicker" role="navigation" aria-label="Selecionar servidor">
    <a class="${current === "solo-duo" ? "active" : ""}" href="${basePath}?server=solo-duo"><span>SOLO/DUO</span><small>ATIVO</small></a>
    <a class="${current === "trio" ? "active" : ""} ${ready ? "" : "soon"}" href="${basePath}?server=trio"><span>${trioLabel}</span><small>${ready ? "ATIVO" : "LANÇAMENTO EM BREVE"}</small></a>
  </div>`;
}

const selectorCss = `<style id="gf-multi-server-ui">
.gfServerPicker{display:flex;justify-content:center;gap:8px;flex-wrap:wrap;margin:0 auto 18px}.gfServerPicker a{min-width:150px;padding:10px 14px;border:1px solid #2d3439;background:#090d0f;color:#a6adb2;text-decoration:none;text-align:left;transition:.2s}.gfServerPicker a span{display:block;font-size:10px;font-weight:1000;letter-spacing:.08em}.gfServerPicker a small{display:block;margin-top:4px;font-size:7px;letter-spacing:.08em;color:#6f787e}.gfServerPicker a.active{border-color:#e79a0b;background:#151007;color:#fff;box-shadow:0 0 0 1px #f5a20b22}.gfServerPicker a.active small{color:#f5b53b}.gfServerPicker a.soon:not(.active){opacity:.76}.gfServerSoon{border:1px solid #6c4a16;background:linear-gradient(135deg,#181006,#0a0d0f);padding:16px 18px;margin:0 0 14px;color:#f5c266;font-size:10px;line-height:1.55}.gfServerSoon b{color:#fff}@media(max-width:700px){.gfServerPicker{display:grid;grid-template-columns:1fr 1fr}.gfServerPicker a{min-width:0}}
</style>`;

export function enhanceStatusHtml(html: string, req: Request): string {
  const current = selectedServer(req.query.server);
  const ready = trioReady();
  let out = html.replace("</head>", `${selectorCss}</head>`);
  out = out.replace('<section class="hero">', `<section class="hero">${selectorHtml(current, "/api/status")}`);
  out = out.replace(/fetch\('\/api\/status\/data'/g, `fetch('/api/status/data?server=${current}'`)
           .replace(/fetch\('\/api\/status\/events'/g, `fetch('/api/status/events?server=${current}'`);
  if (current === "trio") {
    out = out.replace(/Guerra Fria 2X • Duo\./g, ready ? "Dados em tempo real do Guerra Fria 2X • Trio." : "O Guerra Fria Trio está chegando.");
    out = out.replace(/RUST 2X • DUO/g, "RUST 2X • TRIO");
    out = out.replace("last=d;$('state').textContent=d.online?'SERVIDOR ONLINE':'SERVIDOR OFFLINE';$('dot').style.background=d.online?'#38cf7a':'#ef4444';", "last=d;if(d.comingSoon){$('state').textContent='TRIO • EM BREVE';$('dot').style.background='#f5ad2f';$('players').textContent='—';$('slots').textContent='—';$('queue').textContent='—';$('sleepers').textContent='—';$('map').textContent='Em breve';$('uptime').textContent='—';$('lastWipe').textContent='—';$('nextWipe').textContent='—';$('updated').textContent='Novidades do Trio em breve';population(d);return;}$('state').textContent=d.online?'SERVIDOR ONLINE':'SERVIDOR OFFLINE';$('dot').style.background=d.online?'#38cf7a':'#ef4444';");
    if (!ready) {
      out = out.replace('<section class="population">', `<div class="gfServerSoon"><b>TRIO • EM BREVE</b><br>O novo servidor Trio do Guerra Fria está chegando. Em breve você poderá acompanhar jogadores online, status, mapa e todas as informações do servidor por aqui.</div><section class="population">`);
    }
  }
  return out;
}

export function enhanceHomeHtml(html: string, req: Request): string {
  const current = selectedServer(req.query.server);
  const ready = trioReady();
  let out = html.replace("</head>", `${selectorCss}</head>`);
  out = out.replace('<section class="hero">', `<section class="hero"><div class="wrap" style="position:relative;z-index:8;padding-top:12px">${selectorHtml(current, "/")}</div>`);
  out = out.replace(/fetch\('\/api\/status\/data'/g, `fetch('/api/status/data?server=${current}'`);
  if (current === "trio") {
    out = out.replace(/RUST 2X • DUO/g, "RUST 2X • TRIO").replace(/RUST 2X - DUO/g, "RUST 2X - TRIO");
    out = out.replace(/<strong>DUO<\/strong><small>TEAM LIMIT • MÁX\. 2 JOGADORES<\/small>/g, '<strong>TRIO</strong><small>TEAM LIMIT • MÁX. 3 JOGADORES</small>');
    out = out.replace(/href="\/api\/status"/g, 'href="/api/status?server=trio"');
    if (!ready) {
      out = out.replace(/<strong id="serverState">[^<]*<\/strong>/, '<strong class="green" id="serverState" style="color:#f5ad2f">EM BREVE</strong>');
      out = out.replace(/<b id="serverPlayers">[^<]*<\/b>/, '<b id="serverPlayers">— / —</b>');
      out = out.replace('<section class="infoStrip">', `<section class="infoStrip"><div class="wrap"><div class="gfServerSoon"><b>TRIO • EM BREVE</b><br>O novo servidor Trio do Guerra Fria está chegando. Em breve você poderá jogar com seu trio e acompanhar todas as novidades, jogadores online e status do servidor por aqui.</div></div>`);
      out = out.replace("const online=Boolean(d.online);state.textContent=online?'SERVIDOR ONLINE':'SERVIDOR OFFLINE'", "const online=Boolean(d.online);if(d.comingSoon){state.textContent='EM BREVE';state.style.color='#f5ad2f';head.textContent='Trio • Em breve';dot.style.background='#f5ad2f';document.getElementById('serverPlayers').textContent='— / —';return;}state.textContent=online?'SERVIDOR ONLINE':'SERVIDOR OFFLINE'");
    }
  }
  return out;
}

export function currentServerLabel(req: Request) {
  const id = selectedServer(req.query.server);
  return { id, label: id === "trio" ? "Trio" : "Solo/Duo", trioConfigured: trioReady() };
}

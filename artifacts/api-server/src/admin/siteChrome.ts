export type SiteSection = "home" | "leaderboard" | "integrity" | "admin";

function esc(v: string): string {
  return String(v).replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c] || c));
}

export function withSiteChrome(html: string, section: SiteSection, opts?: { isAdmin?: boolean; username?: string }): string {
  const isAdmin = Boolean(opts?.isAdmin);
  const username = esc(opts?.username || "");
  const links = [
    ["home", "/", "⌂", "Portal"],
    ["leaderboard", "/leaderboard", "🏆", "Leaderboard"],
    ["integrity", "/comunidade", "🛡️", "Integridade"],
    ...(isAdmin ? [["admin", "/admin", "⚙", "Controle"]] : []),
  ] as string[][];
  const navLinks = links.map(([id, href, icon, label]) => `<a class="gfNavItem${section===id?" active":""}" href="${href}"><span>${icon}</span><b>${label}</b></a>`).join("");
  const chrome = `<div class="gfChrome"><div class="gfChromeInner"><button class="gfBack" type="button" onclick="history.length>1?history.back():location.href='/'" aria-label="Voltar">← <span>Voltar</span></button><a class="gfChromeBrand" href="/"><i>GF</i><span><b>GUERRA FRIA</b><small>PORTAL OFICIAL</small></span></a><nav class="gfNav">${navLinks}</nav>${username?`<div class="gfUser"><span class="gfOnline"></span><span>${username}</span></div>`:""}</div></div>`;
  const css = `<style id="gf-site-chrome">
:root{--gf-chrome:#09060ef2;--gf-chrome-line:#352445;--gf-chrome-text:#fff;--gf-chrome-muted:#93859f;--gf-chrome-purple:#9b6cff;--gf-chrome-yellow:#ffd84d}
html{scroll-padding-top:78px}body{padding-top:68px!important}.gfChrome{position:fixed;inset:0 0 auto 0;height:68px;z-index:99990;background:linear-gradient(180deg,#0b0712fa,#08050dfa);border-bottom:1px solid var(--gf-chrome-line);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);box-shadow:0 14px 44px #0007}.gfChromeInner{height:100%;width:min(1220px,calc(100% - 24px));margin:auto;display:flex;align-items:center;gap:13px}.gfBack{height:38px;border:1px solid #3c2a4d;background:#120c19;color:#d6cadf;border-radius:11px;padding:0 12px;font-weight:850;cursor:pointer}.gfChromeBrand{display:flex;align-items:center;gap:9px;text-decoration:none;color:#fff;min-width:max-content}.gfChromeBrand i{width:38px;height:38px;border-radius:11px;display:grid;place-items:center;border:1px solid #60417f;background:linear-gradient(145deg,#261536,#130b1c);font-style:normal;color:var(--gf-chrome-yellow);font-weight:1000}.gfChromeBrand span{display:flex;flex-direction:column;line-height:1.05}.gfChromeBrand b{font-size:11px;letter-spacing:.13em}.gfChromeBrand small{font-size:7px;color:#84768e;letter-spacing:.16em;margin-top:4px}.gfNav{display:flex;align-items:center;gap:5px;margin-left:auto}.gfNavItem{display:flex;align-items:center;gap:6px;height:38px;padding:0 11px;border-radius:10px;text-decoration:none;color:#9d90a9;border:1px solid transparent;font-size:11px;transition:.18s}.gfNavItem:hover{color:#fff;background:#171020;border-color:#39274b}.gfNavItem.active{color:#fff;background:linear-gradient(135deg,#28183a,#1a1025);border-color:#624181;box-shadow:inset 0 0 18px #8b5cf615}.gfNavItem.active span{filter:drop-shadow(0 0 5px #a879ff)}.gfUser{display:flex;align-items:center;gap:7px;max-width:150px;border-left:1px solid #30213d;padding-left:12px;color:#b9adbf;font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.gfOnline{width:7px;height:7px;flex:0 0 7px;background:#35e58a;border-radius:50%;box-shadow:0 0 12px #35e58a88}
@media(max-width:760px){body{padding-top:61px!important;padding-bottom:74px!important}.gfChrome{height:61px}.gfChromeInner{width:calc(100% - 18px);gap:8px}.gfBack{width:38px;padding:0;font-size:18px}.gfBack span,.gfChromeBrand span,.gfUser{display:none}.gfChromeBrand i{width:38px;height:38px}.gfNav{position:fixed;left:8px;right:8px;bottom:max(8px,env(safe-area-inset-bottom));height:58px;padding:5px;background:#0b0712f7;border:1px solid #39274b;border-radius:17px;display:grid;grid-template-columns:repeat(${links.length},1fr);gap:4px;box-shadow:0 18px 55px #000c;backdrop-filter:blur(18px)}.gfNavItem{height:46px;padding:4px;display:flex;flex-direction:column;justify-content:center;gap:2px;font-size:9px;text-align:center}.gfNavItem span{font-size:16px}.gfNavItem b{font-weight:850}.gfNavItem.active{border-color:#6c4790}}
</style>`;
  let out = html.replace("</head>", `${css}</head>`);
  out = out.replace(/<body([^>]*)>/i, `<body$1>${chrome}`);
  return out;
}

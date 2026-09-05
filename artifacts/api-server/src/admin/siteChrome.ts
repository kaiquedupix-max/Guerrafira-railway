export type SiteSection = "home" | "leaderboard" | "integrity" | "admin" | "season" | "status";
import { brandThemeCss } from "./brandTheme.js";
import { publicMilitaryThemeCss } from "./publicMilitaryTheme.js";

function esc(v: string): string {
  return String(v).replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c] || c));
}

export function withSiteChrome(html: string, section: SiteSection, opts?: { isAdmin?: boolean; username?: string }): string {
  const isAdmin = Boolean(opts?.isAdmin);
  const username = esc(opts?.username || "");
  const isAdminPage = section === "admin";
  const effectiveSection = section === "home" && /Loja VIP|LOJA OFICIAL GUERRA FRIA/i.test(html) ? "store" : section;
  const links = [
    ["home", "/", "Início"],
    ["store", "/loja", "Loja"],
    ["leaderboard", "/leaderboard", "Leaderboard"],
    ["season", "/season1", "Season"],
    ["status", "/api/status", "Status"],
  ];
  const navLinks = links.map(([id, href, label]) => `<a class="gfNavItem${effectiveSection===id?" active":""}" href="${href}">${label}</a>`).join("");
  const userBlock = username
    ? `<div class="gfUser"><span class="gfOnline"></span><span>${username}</span></div>`
    : `<a class="gfLogin" href="/api/admin/auth/login?target=home">ENTRAR</a>`;
  const adminLink = isAdmin && !isAdminPage ? `<a class="gfAdminLink" href="/admin">CONTROLE</a>` : "";
  const chrome = `<header class="gfChrome"><div class="gfChromeInner"><a class="gfChromeBrand" href="/"><i>GF</i><b>GUERRA FRIA</b></a><nav class="gfNav">${navLinks}</nav><div class="gfChromeRight">${adminLink}${userBlock}</div></div></header>`;
  const pwaMeta = `<link rel="manifest" href="/api/pwa/manifest"><link rel="apple-touch-icon" href="/api/pwa/icon.svg"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"><meta name="apple-mobile-web-app-title" content="GF Admin">`;
  const css = `<style id="gf-site-chrome">
html{scroll-padding-top:58px}body{padding-top:58px!important}.gfChrome{position:fixed;inset:0 0 auto 0;height:58px;z-index:99990;background:#07090af7;border-bottom:1px solid #171b1e;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}.gfChromeInner{height:100%;width:min(980px,calc(100% - 32px));margin:auto;display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:18px}.gfChromeBrand{justify-self:start;display:flex;align-items:center;gap:9px;text-decoration:none;color:#f3f2ee;font-size:8px;letter-spacing:.16em;font-weight:950;white-space:nowrap}.gfChromeBrand i{width:25px;height:25px;background:#f59d0a;color:#070809;display:grid;place-items:center;font-style:normal;font-size:8px;font-weight:1000}.gfChromeBrand b{font-size:8px;letter-spacing:.16em}.gfNav{display:flex;align-items:center;justify-content:center;gap:4px}.gfNavItem{height:31px;display:grid;place-items:center;padding:0 10px;border:1px solid transparent;text-decoration:none;color:#777f84;font-size:7px;letter-spacing:.13em;font-weight:950;text-transform:uppercase;white-space:nowrap}.gfNavItem:hover{color:#fff}.gfNavItem.active{color:#f4f3ef;border-color:#a66a12;background:#0b0e10}.gfChromeRight{justify-self:end;display:flex;align-items:center;gap:7px;min-width:0}.gfUser,.gfLogin,.gfAdminLink{min-height:31px;padding:0 10px;border:1px solid #262c30;background:#0b0e10;text-decoration:none;color:#dfe1df;font-size:7px;letter-spacing:.11em;font-weight:950;display:flex;align-items:center;gap:7px;white-space:nowrap}.gfUser{max-width:145px;overflow:hidden}.gfUser span:last-child{overflow:hidden;text-overflow:ellipsis}.gfOnline{width:6px;height:6px;border-radius:50%;background:#38cf7a;flex:0 0 6px}.gfAdminLink{border-color:#5c4219;color:#e8b656}.gfLogin{justify-content:center}.gfInstallModal{display:none}
@media(max-width:700px){html{scroll-padding-top:52px}body{padding-top:52px!important}.gfChrome{height:52px}.gfChromeInner{width:calc(100% - 22px);grid-template-columns:auto 1fr auto;gap:6px}.gfChromeBrand b{display:none}.gfNav{gap:0;min-width:0}.gfNavItem{padding:0 4px;font-size:5.4px;letter-spacing:.045em;height:29px}.gfUser,.gfLogin,.gfAdminLink{min-height:29px;padding:0 6px;font-size:6px;max-width:78px}.gfAdminLink{display:none}}
</style>`;
  const sectionTheme = isAdminPage ? brandThemeCss : publicMilitaryThemeCss;
  let out = html.replace("</head>", `${pwaMeta}${css}${sectionTheme}</head>`);
  out = out.replace(/<body([^>]*)>/i, `<body$1>${chrome}`);
  return out;
}

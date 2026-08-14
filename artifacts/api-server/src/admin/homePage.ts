import type { Request } from "express";
import { getCommunitySession } from "./communitySession.js";

export function renderHome(req: Request): string {
  const session = getCommunitySession(req);
  const adminButton = session?.isAdmin ? `<a class="admin" href="/admin">🛡️ Central de Controle Guerra Fria</a>` : "";
  const content = session ? `
    <div class="hello">Conectado como <b>${escapeHtml(session.username)}</b></div>
    <div class="actions">
      <a class="card" href="/leaderboard"><span>🏆</span><div><b>Leaderboard</b><small>Rankings e estatísticas do wipe atual</small></div></a>
      <a class="card" href="/comunidade"><span>🛡️</span><div><b>Central de Integridade</b><small>Punições, advertências e verificações do servidor</small></div></a>
    </div>${adminButton}` : `
    <p>Entre com sua conta do Discord para acessar o Leaderboard e a Central de Integridade do Guerra Fria.</p>
    <a class="login" href="/api/admin/auth/login?target=home">Entrar com Discord</a>`;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#08060d"><title>Guerra Fria</title><style>
  :root{--bg:#08060d;--panel:#120d19;--line:#39284d;--muted:#9a8da8;--purple:#8b5cf6;--yellow:#ffd84d}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at 50% -10%,#251438 0,#08060d 42%);color:#fff;font-family:Inter,system-ui;display:grid;place-items:center;padding:18px}.wrap{width:min(820px,100%);text-align:center}.logo{font-size:13px;letter-spacing:.28em;color:var(--yellow);font-weight:1000}.title{font-size:clamp(42px,8vw,78px);margin:8px 0 6px;line-height:.95}.sub{color:var(--muted);margin-bottom:28px}.box{background:#100c16dd;border:1px solid var(--line);border-radius:24px;padding:24px;box-shadow:0 30px 90px #0009}.box p{color:var(--muted);line-height:1.6}.login,.admin{display:inline-block;text-decoration:none;border-radius:13px;padding:13px 17px;font-weight:900}.login{background:#5865f2;color:#fff}.admin{margin-top:14px;background:#21152f;color:#fff;border:1px solid #60428b}.hello{color:var(--muted);margin-bottom:15px}.actions{display:grid;grid-template-columns:1fr 1fr;gap:12px}.card{display:flex;gap:14px;align-items:center;text-align:left;text-decoration:none;color:#fff;background:#15101d;border:1px solid var(--line);border-radius:17px;padding:18px;min-height:105px}.card:hover{border-color:#7852a8}.card span{font-size:31px}.card b{font-size:18px}.card small{display:block;color:var(--muted);margin-top:5px;line-height:1.35}@media(max-width:620px){body{align-items:start;padding-top:12vh}.box{padding:16px}.actions{grid-template-columns:1fr}.card{min-height:86px;padding:15px}.title{font-size:50px}}
  </style></head><body><main class="wrap"><div class="logo">GUERRA FRIA</div><h1 class="title">Guerra Fria</h1><div class="sub">Servidor competitivo • transparência • comunidade</div><section class="box">${content}</section></main></body></html>`;
}
function escapeHtml(v:string){return String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]||c));}

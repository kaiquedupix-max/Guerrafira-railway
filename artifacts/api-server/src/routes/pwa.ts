import { Router } from "express";
import { consumePwaAdminGrant } from "../admin/oauthRoutesV3.js";

const router = Router();

const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#28183a"/><stop offset="1" stop-color="#09060f"/></linearGradient></defs>
<rect width="512" height="512" rx="110" fill="#09060f"/><rect x="28" y="28" width="456" height="456" rx="96" fill="url(#g)" stroke="#8b5cf6" stroke-width="10"/><rect x="78" y="78" width="356" height="356" rx="72" fill="none" stroke="#ffd84d" stroke-width="6"/><text x="256" y="292" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="170" font-weight="900" fill="#ffd84d">GF</text><text x="256" y="366" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="38" font-weight="800" letter-spacing="7" fill="#f7f2ff">ADMIN</text></svg>`;

router.get("/pwa/manifest", (_req, res) => {
  res.type("application/manifest+json").send(JSON.stringify({
    id: "/admin",
    name: "Guerra Fria Admin",
    short_name: "GF Admin",
    description: "Central de Controle administrativa do servidor Guerra Fria",
    start_url: "/api/pwa/launch",
    scope: "/",
    display: "standalone",
    background_color: "#07050b",
    theme_color: "#09060f",
    orientation: "portrait-primary",
    icons: [{ src: "/api/pwa/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }]
  }));
});

router.get("/pwa/launch", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.status(200).type("html").send(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#07050b"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"><meta name="apple-mobile-web-app-title" content="GF Admin"><link rel="manifest" href="/api/pwa/manifest"><title>Guerra Fria Admin</title><style>*{box-sizing:border-box}html,body{margin:0;min-height:100%;background:#07050b;color:#fff;font-family:Inter,system-ui,-apple-system,sans-serif}body{min-height:100vh;display:grid;place-items:center;padding:max(20px,env(safe-area-inset-top)) 20px max(20px,env(safe-area-inset-bottom))}.box{width:min(520px,100%);background:linear-gradient(180deg,#120d19,#0b0810);border:1px solid #382946;border-radius:24px;padding:28px;text-align:center;box-shadow:0 28px 90px #000a}.brand{font-size:12px;font-weight:1000;letter-spacing:.16em;color:#ffd84d}.box h1{font-size:34px;margin:8px 0}.box p{color:#a89eb1;line-height:1.55}.btn{display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:0 18px;border-radius:12px;background:#5865f2;color:#fff;text-decoration:none;font-weight:950;border:1px solid #7c86ff}.wait{margin-top:15px;color:#9d91aa;font-size:12px}.hidden{display:none!important}.ok{color:#86efac}</style></head><body><main class="box"><div class="brand">GUERRA FRIA • CENTRAL DE CONTROLE</div><h1>Admin</h1><p id="text">Verificando este dispositivo...</p><a id="login" class="btn hidden" target="_blank" rel="noopener">Entrar com Discord</a><div id="wait" class="wait"></div></main><script>(function(){const text=document.getElementById('text'),login=document.getElementById('login'),wait=document.getElementById('wait');const key='gf_admin_token',deviceKey='gf_admin_device';let device=localStorage.getItem(deviceKey)||'';if(!/^[A-Za-z0-9_-]{16,128}$/.test(device)){device=(crypto.randomUUID?crypto.randomUUID():Math.random().toString(36).slice(2)+Date.now().toString(36));localStorage.setItem(deviceKey,device)}function go(token){location.replace('/painel?auth='+encodeURIComponent(token))}async function valid(token){try{const r=await fetch('/api/admin/me',{cache:'no-store',headers:{Authorization:'Bearer '+token}});return r.ok}catch{return false}}async function poll(){try{const r=await fetch('/api/pwa/auth/status?device='+encodeURIComponent(device),{cache:'no-store'});if(r.status===204)return;const j=await r.json().catch(()=>({}));if(r.ok&&j.token){localStorage.setItem(key,j.token);text.textContent='Autenticação concluída.';text.className='ok';wait.textContent='Abrindo painel...';go(j.token)}}catch{}}async function boot(){const token=localStorage.getItem(key)||'';if(token&&await valid(token)){go(token);return}if(token)localStorage.removeItem(key);text.textContent='Entre uma vez com o Discord para autorizar este aparelho. Depois disso o aplicativo abrirá direto no painel.';login.href='/api/admin/auth/login?target=admin&device='+encodeURIComponent(device);login.classList.remove('hidden');wait.textContent='Após autorizar no Discord, volte para este aplicativo.';setInterval(poll,1400);window.addEventListener('focus',poll);document.addEventListener('visibilitychange',()=>{if(!document.hidden)poll()})}boot()})();</script></body></html>`);
});

router.get("/pwa/auth/status", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const token = consumePwaAdminGrant(req.query.device);
  if (!token) return void res.status(204).end();
  return void res.status(200).json({ ok: true, token });
});

router.get("/pwa/icon.svg", (_req, res) => {
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.type("image/svg+xml").send(iconSvg);
});

router.get("/pwa/sw.js", (_req, res) => {
  res.setHeader("Service-Worker-Allowed", "/");
  res.setHeader("Cache-Control", "no-store");
  res.type("application/javascript").send(`
const CACHE='gf-admin-shell-v3';
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(CACHE).then(c=>c.addAll(['/api/pwa/launch','/'])).catch(()=>{}))});
self.addEventListener('activate',e=>e.waitUntil(Promise.all([self.clients.claim(),caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))])));
self.addEventListener('fetch',e=>{const r=e.request;if(r.method!=='GET')return;if(new URL(r.url).origin!==location.origin)return;e.respondWith(fetch(r).catch(()=>caches.match(r).then(x=>x||caches.match('/api/pwa/launch'))))});
self.addEventListener('push',e=>{let d={};try{d=e.data?e.data.json():{}}catch{d={body:e.data?e.data.text():''}};const title=d.title||'Guerra Fria Admin';const options={body:d.body||'Novo alerta administrativo.',icon:'/api/pwa/icon.svg',badge:'/api/pwa/icon.svg',tag:d.tag||'gf-admin-alert',renotify:true,data:{url:d.url||'/admin'},vibrate:[200,100,200]};e.waitUntil(self.registration.showNotification(title,options))});
self.addEventListener('notificationclick',e=>{e.notification.close();const target=e.notification.data?.url||'/api/pwa/launch';e.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(ws=>{const w=ws[0];if(w){w.navigate(target).catch(()=>{});return w.focus()}return clients.openWindow(target)}))});
`);
});

export default router;

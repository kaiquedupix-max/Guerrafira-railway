import { Router } from "express";

const router = Router();

const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#28183a"/><stop offset="1" stop-color="#09060f"/></linearGradient></defs>
<rect width="512" height="512" rx="110" fill="#09060f"/><rect x="28" y="28" width="456" height="456" rx="96" fill="url(#g)" stroke="#8b5cf6" stroke-width="10"/><rect x="78" y="78" width="356" height="356" rx="72" fill="none" stroke="#ffd84d" stroke-width="6"/><text x="256" y="292" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="170" font-weight="900" fill="#ffd84d">GF</text><text x="256" y="366" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="38" font-weight="800" letter-spacing="7" fill="#f7f2ff">ADMIN</text></svg>`;

router.get("/pwa/manifest", (_req, res) => {
  res.type("application/manifest+json").send(JSON.stringify({
    name: "Guerra Fria Admin",
    short_name: "GF Admin",
    description: "Central de Controle administrativa do servidor Guerra Fria",
    start_url: "/admin?source=pwa",
    scope: "/",
    display: "standalone",
    background_color: "#07050b",
    theme_color: "#09060f",
    orientation: "portrait-primary",
    icons: [{ src: "/api/pwa/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }]
  }));
});

router.get("/pwa/icon.svg", (_req, res) => {
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.type("image/svg+xml").send(iconSvg);
});

router.get("/pwa/sw.js", (_req, res) => {
  res.setHeader("Service-Worker-Allowed", "/");
  res.setHeader("Cache-Control", "no-store");
  res.type("application/javascript").send(`
const CACHE='gf-admin-shell-v2';
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(CACHE).then(c=>c.addAll(['/admin','/'])).catch(()=>{}))});
self.addEventListener('activate',e=>e.waitUntil(Promise.all([self.clients.claim(),caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))])));
self.addEventListener('fetch',e=>{const r=e.request;if(r.method!=='GET')return;if(new URL(r.url).origin!==location.origin)return;e.respondWith(fetch(r).catch(()=>caches.match(r).then(x=>x||caches.match('/admin'))))});
self.addEventListener('push',e=>{let d={};try{d=e.data?e.data.json():{}}catch{d={body:e.data?e.data.text():''}};const title=d.title||'Guerra Fria Admin';const options={body:d.body||'Novo alerta administrativo.',icon:'/api/pwa/icon.svg',badge:'/api/pwa/icon.svg',tag:d.tag||'gf-admin-alert',renotify:true,data:{url:d.url||'/admin'},vibrate:[200,100,200]};e.waitUntil(self.registration.showNotification(title,options))});
self.addEventListener('notificationclick',e=>{e.notification.close();const target=e.notification.data?.url||'/admin';e.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(ws=>{const w=ws.find(x=>x.url.includes('/admin'));if(w){w.navigate(target).catch(()=>{});return w.focus()}return clients.openWindow(target)}))});
`);
});

export default router;

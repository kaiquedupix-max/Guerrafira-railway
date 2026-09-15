import type { Request } from "express";
import { renderHome as renderBaseHome } from "./homePage.js";

/**
 * Ajustes finais da landing page aprovados a partir do mockup 1672x941.
 * Mantemos os dados e comportamentos do homePage e sobrescrevemos apenas
 * composição/proporções. Isso evita que temas globais alterem a landing.
 */
export function renderHome(req: Request): string {
  const base = renderBaseHome(req)
    .replace('src="/api/home/banner"', 'src="/api/home/banner?v=mockup-20260915"');

  const mockupCss = `<style id="gf-home-approved-mockup">
/* Referência desktop: mockup aprovado 1672 x 941 */
@media (min-width:1301px){
  :root{--page:1594px!important}
  body{background:#050708!important}
  .wrap{width:min(1594px,calc(100% - 78px))!important;max-width:none!important}

  .top{height:74px!important;background:#060809f7!important;border-bottom:1px solid #20262a!important}
  .nav{grid-template-columns:1fr auto 1fr!important;gap:24px!important}
  .brand i{width:42px!important;height:42px!important}
  .menu a{height:44px!important;padding:0 24px!important}
  .headerStatus{height:44px!important;min-width:158px!important;text-decoration:none!important}
  .headerStatus,.headerStatus *{text-decoration:none!important}

  .hero{height:420px!important;background:#06090a!important;overflow:hidden!important}
  .heroGrid{height:420px!important;grid-template-columns:38% 62%!important;overflow:visible!important}
  .heroCopy{height:420px!important;padding:32px 24px 25px 17px!important;justify-content:center!important;background:#06090a!important;z-index:7!important}
  .ey{font-size:11px!important;letter-spacing:.42em!important;margin-bottom:16px!important}
  .hero h1{font-size:76px!important;line-height:.86!important;letter-spacing:-.004em!important}
  .heroLead{max-width:540px!important;margin-top:17px!important;font-size:15px!important;line-height:1.48!important}
  .heroActions{grid-template-columns:230px 224px 288px!important;gap:14px!important;margin-top:25px!important}
  .heroBtn{height:57px!important}

  .heroVisual{height:420px!important;margin-left:-44px!important;overflow:hidden!important;background:#111!important;z-index:2!important}
  .heroVisual:before{z-index:4!important;background:linear-gradient(90deg,#06090a 0%,#06090ae8 4%,#06090a86 12%,#06090a25 23%,transparent 32%)!important}
  .heroBanner{display:block!important;visibility:visible!important;opacity:1!important;z-index:1!important;inset:0!important;width:100%!important;height:100%!important;object-fit:cover!important;object-position:center center!important;filter:saturate(1.05) contrast(1.03)!important;transform:scale(1.005)!important}
  .heroGlow{z-index:3!important;opacity:.35!important}

  .infoStrip{padding:0 0 17px!important;background:#06090a!important}
  .infoGrid{grid-template-columns:1.05fr 1.05fr .93fr 1.05fr!important;gap:15px!important}
  .infoCard{height:90px!important;padding:15px 17px!important}

  .portal{padding:0 0 23px!important;background:#06090a!important}
  .portalGrid{grid-template-columns:29% 35.4% 35.6%!important;gap:15px!important}
  .feature{height:246px!important}
  .storeCopy{top:38px!important}
  .communityCard{padding:27px 31px!important}
  .footer{height:75px!important}
}

/* Banner sempre precisa permanecer visível mesmo durante reveal/tilt. */
.heroVisual.reveal{filter:none!important}
.heroVisual.reveal.in{opacity:1!important;filter:none!important}
.heroVisual .heroBanner{pointer-events:none}

@media (min-width:1500px){
  .hero h1{font-size:78px!important}
}
</style>`;

  return base.replace("</head>", `${mockupCss}</head>`);
}

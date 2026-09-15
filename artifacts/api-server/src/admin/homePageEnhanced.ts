import type { Request } from "express";
import { renderHome as renderBaseHome } from "./homePage.js";

/** Landing Guerra Fria alinhada ao mockup aprovado e às artes geradas. */
export function renderHome(req: Request): string {
  const base = renderBaseHome(req)
    .replace('src="/api/home/banner"', 'src="/api/home/art/hero?v=generated-20260915"');

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
  .heroVisual:before{z-index:4!important;background:linear-gradient(90deg,#06090a 0%,#06090ae8 4%,#06090a7a 12%,#06090a22 23%,transparent 34%)!important}
  .heroBanner{display:block!important;visibility:visible!important;opacity:1!important;z-index:1!important;inset:0!important;width:100%!important;height:100%!important;object-fit:cover!important;object-position:center center!important;filter:saturate(1.08) contrast(1.04)!important;transform:scale(1.005)!important;image-rendering:auto!important}
  .heroGlow{z-index:3!important;opacity:.25!important}

  .infoStrip{padding:0 0 17px!important;background:#06090a!important}
  .infoGrid{grid-template-columns:1.05fr 1.05fr .93fr 1.05fr!important;gap:15px!important}
  .infoCard{height:90px!important;padding:15px 17px!important}

  .portal{padding:0 0 23px!important;background:#06090a!important}
  .portalGrid{grid-template-columns:29% 35.4% 35.6%!important;gap:15px!important}
  .feature{height:246px!important}
  .storeCard{background:#090d0f!important}
  .storeArt{width:48%!important;background-image:linear-gradient(90deg,rgba(5,7,8,.02),rgba(5,7,8,.42)),url('/api/home/art/store?v=generated-20260915')!important;background-size:cover!important;background-position:center!important;background-repeat:no-repeat!important}
  .crate{display:none!important}
  .storeCopy{left:45%!important;top:38px!important;z-index:3!important}
  .communityCard{padding:27px 31px!important;background-image:linear-gradient(90deg,rgba(7,9,10,.98) 0%,rgba(7,9,10,.88) 48%,rgba(7,9,10,.38) 100%),url('/api/home/art/community?v=generated-20260915')!important;background-size:cover!important;background-position:center!important;background-repeat:no-repeat!important}
  .communityCard>*{position:relative;z-index:2}
  .footer{height:75px!important}
}

.heroVisual.reveal{filter:none!important}
.heroVisual.reveal.in{opacity:1!important;filter:none!important}
.heroVisual .heroBanner{pointer-events:none}

@media (min-width:1500px){.hero h1{font-size:78px!important}}
@media (max-width:1300px){
  .heroBanner{content:url('/api/home/art/hero?v=generated-20260915')!important}
  .storeArt{background-image:linear-gradient(90deg,rgba(5,7,8,.05),rgba(5,7,8,.5)),url('/api/home/art/store?v=generated-20260915')!important;background-size:cover!important;background-position:center!important}
  .crate{display:none!important}
  .communityCard{background-image:linear-gradient(90deg,rgba(7,9,10,.97),rgba(7,9,10,.62)),url('/api/home/art/community?v=generated-20260915')!important;background-size:cover!important;background-position:center!important}
}
</style>`;

  return base.replace("</head>", `${mockupCss}</head>`);
}

import type { Request } from "express";
import { renderHome as renderBaseHome } from "./homePage.js";

/** Landing Guerra Fria alinhada ao mockup aprovado e às artes geradas. */
export function renderHome(req: Request): string {
  const base = renderBaseHome(req)
    .replace('src="/api/home/banner"', 'src="/api/home/art/hero?v=generated-20260915"');

  const mockupCss = `<style id="gf-home-approved-mockup">
/* Referência desktop: mockup aprovado 1672 x 941 */
body{
  background:
    radial-gradient(980px 560px at 77% 9%,rgba(247,160,6,.085) 0%,rgba(247,160,6,0) 64%),
    radial-gradient(760px 500px at 9% 73%,rgba(139,72,18,.075) 0%,rgba(139,72,18,0) 68%),
    linear-gradient(180deg,#06090a 0%,#050708 48%,#040607 100%)!important;
  background-attachment:fixed!important;
}

@media (min-width:1301px){
  :root{--page:1594px!important}
  .wrap{width:min(1594px,calc(100% - 78px))!important;max-width:none!important}
  .top{height:74px!important;background:#060809f2!important;border-bottom:1px solid #20262a!important}
  .nav{grid-template-columns:1fr auto 1fr!important;gap:24px!important}
  .brand i{width:42px!important;height:42px!important}
  .menu a{height:44px!important;padding:0 24px!important}
  .headerStatus{height:44px!important;min-width:158px!important;text-decoration:none!important}
  .headerStatus,.headerStatus *{text-decoration:none!important}

  .hero{height:420px!important;background:linear-gradient(180deg,#06090a 0%,#06090af5 100%)!important;overflow:hidden!important}
  .heroGrid{height:420px!important;grid-template-columns:38% 62%!important;overflow:visible!important}
  .heroCopy{height:420px!important;padding:32px 24px 25px 17px!important;justify-content:center!important;background:linear-gradient(90deg,#06090a 0%,#06090af8 76%,#06090ad8 100%)!important;z-index:7!important}
  .ey{font-size:11px!important;letter-spacing:.42em!important;margin-bottom:16px!important}
  .hero h1{font-size:76px!important;line-height:.86!important;letter-spacing:-.004em!important}
  .heroLead{max-width:540px!important;margin-top:17px!important;font-size:15px!important;line-height:1.48!important}
  .heroActions{grid-template-columns:230px 224px 288px!important;gap:14px!important;margin-top:25px!important}
  .heroBtn{height:57px!important}
  .heroVisual{height:420px!important;margin-left:-44px!important;overflow:hidden!important;background:#111!important;z-index:2!important}
  .heroVisual:before{z-index:4!important;background:linear-gradient(90deg,#06090a 0%,#06090ae8 4%,#06090a7a 12%,#06090a22 23%,transparent 34%),linear-gradient(180deg,transparent 72%,rgba(6,9,10,.68) 100%)!important}
  .heroBanner{display:block!important;visibility:visible!important;opacity:1!important;z-index:1!important;inset:0!important;width:100%!important;height:100%!important;object-fit:cover!important;object-position:center center!important;filter:saturate(1.08) contrast(1.04)!important;transform:scale(1.005)!important;image-rendering:auto!important}
  .heroGlow{z-index:3!important;opacity:.25!important}

  .infoStrip{
    padding:0 0 17px!important;
    background:linear-gradient(180deg,rgba(6,9,10,.985) 0%,rgba(6,9,10,.955) 72%,rgba(5,7,8,.92) 100%)!important;
  }
  .infoGrid{grid-template-columns:1.05fr 1.05fr .93fr 1.05fr!important;gap:15px!important}
  .infoCard{height:90px!important;padding:15px 17px!important;background:linear-gradient(145deg,rgba(12,17,19,.96),rgba(7,11,13,.96))!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.015)!important}

  .portal{
    padding:0 0 23px!important;
    background:
      radial-gradient(720px 320px at 11% 46%,rgba(132,64,16,.095),transparent 66%),
      radial-gradient(760px 330px at 89% 49%,rgba(247,160,6,.06),transparent 68%),
      linear-gradient(180deg,rgba(5,7,8,.93) 0%,rgba(4,6,7,.985) 100%)!important;
  }
  .portalGrid{grid-template-columns:29% 35.4% 35.6%!important;gap:15px!important}
  .feature{height:246px!important;box-shadow:0 16px 40px rgba(0,0,0,.17)!important}

  .storeCard{
    background:
      radial-gradient(circle at 7% 90%,rgba(142,67,15,.16),transparent 38%),
      linear-gradient(90deg,#0c0d0d 0%,#090d0f 48%,#070a0c 100%)!important;
  }
  .storeArt{
    width:49%!important;
    background-image:url('/api/home/art/store?v=generated-20260915')!important;
    background-size:cover!important;
    background-position:center!important;
    background-repeat:no-repeat!important;
    filter:saturate(1.03) contrast(1.02)!important;
  }
  .storeArt:after{
    content:'';
    position:absolute;
    inset:0;
    pointer-events:none;
    background:
      linear-gradient(90deg,rgba(5,7,8,.02) 0%,rgba(5,7,8,.08) 35%,rgba(5,7,8,.38) 65%,rgba(9,13,15,.9) 94%,#090d0f 100%),
      linear-gradient(180deg,rgba(0,0,0,.02) 0%,rgba(0,0,0,.18) 100%);
  }
  .storeCard:after{
    content:'';
    position:absolute;
    inset:0;
    pointer-events:none;
    z-index:2;
    background:linear-gradient(90deg,transparent 0%,transparent 30%,rgba(9,13,15,.08) 40%,rgba(9,13,15,.82) 51%,#090d0f 59%,#090d0f 100%);
  }
  .crate{display:none!important}
  .storeCopy{left:45%!important;top:38px!important;z-index:3!important}

  .communityCard{
    padding:27px 31px!important;
    background-image:
      linear-gradient(90deg,rgba(7,9,10,.985) 0%,rgba(7,9,10,.90) 42%,rgba(7,9,10,.55) 73%,rgba(7,9,10,.34) 100%),
      linear-gradient(180deg,rgba(0,0,0,.06),rgba(0,0,0,.28)),
      url('/api/home/art/community?v=generated-20260915')!important;
    background-size:cover!important;
    background-position:center!important;
    background-repeat:no-repeat!important;
  }
  .communityCard>*{position:relative;z-index:2}
  .communityCard:after{
    content:''!important;
    position:absolute!important;
    inset:0!important;
    width:auto!important;
    height:auto!important;
    right:auto!important;
    bottom:auto!important;
    background:radial-gradient(circle at 88% 88%,rgba(247,160,6,.08),transparent 38%)!important;
    pointer-events:none!important;
    z-index:1!important;
  }
  .communityStats{
    border-top:0!important;
    left:22px!important;
    right:22px!important;
    bottom:14px!important;
    padding:11px 13px 0!important;
    background:linear-gradient(90deg,rgba(5,7,8,.36),rgba(5,7,8,.20),rgba(5,7,8,.06))!important;
    backdrop-filter:blur(1.5px)!important;
  }
  .communityStats:before,.communityStats:after{display:none!important}
  .communityCard hr{display:none!important}

  .footer{
    height:75px!important;
    background:linear-gradient(180deg,rgba(5,7,8,.98),#040607)!important;
    border-top-color:#20262a!important;
  }
}

.heroVisual.reveal{filter:none!important}
.heroVisual.reveal.in{opacity:1!important;filter:none!important}
.heroVisual .heroBanner{pointer-events:none}

@media (min-width:1500px){.hero h1{font-size:78px!important}}
@media (max-width:1300px){
  .heroBanner{content:url('/api/home/art/hero?v=generated-20260915')!important}
  .infoStrip{background:linear-gradient(180deg,rgba(6,9,10,.985),rgba(5,7,8,.94))!important}
  .portal{background:radial-gradient(620px 260px at 10% 45%,rgba(132,64,16,.08),transparent 65%),linear-gradient(180deg,rgba(5,7,8,.95),rgba(4,6,7,.99))!important}
  .storeArt{background-image:url('/api/home/art/store?v=generated-20260915')!important;background-size:cover!important;background-position:center!important}
  .storeArt:after{content:'';position:absolute;inset:0;background:linear-gradient(90deg,rgba(5,7,8,.02),rgba(5,7,8,.16) 46%,rgba(9,13,15,.76) 100%);pointer-events:none}
  .crate{display:none!important}
  .communityCard{background-image:linear-gradient(90deg,rgba(7,9,10,.97),rgba(7,9,10,.60)),url('/api/home/art/community?v=generated-20260915')!important;background-size:cover!important;background-position:center!important}
  .communityStats{border-top:0!important;background:rgba(5,7,8,.18)!important}
  .communityCard hr{display:none!important}
}
</style>`;

  return base.replace("</head>", `${mockupCss}</head>`);
}

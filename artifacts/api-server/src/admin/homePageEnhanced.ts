import type { Request } from "express";
import { renderHome as renderBaseHome } from "./homePage.js";

/** Landing Guerra Fria alinhada ao mockup final aprovado. */
export function renderHome(req: Request): string {
  const base = renderBaseHome(req)
    .replace('src="/api/home/banner"', 'src="/api/home/art/hero?v=target-final-20260915-1414"');

  const mockupCss = `<style id="gf-home-approved-mockup">
/* Referência visual final: mockup aprovado pelo usuário. */
body{
  background:
    radial-gradient(980px 650px at -5% 43%,rgba(238,103,10,.20) 0%,rgba(238,103,10,.09) 30%,rgba(238,103,10,0) 68%),
    radial-gradient(1050px 700px at 105% 39%,rgba(247,117,10,.22) 0%,rgba(247,117,10,.10) 31%,rgba(247,117,10,0) 70%),
    radial-gradient(900px 520px at 72% 5%,rgba(247,160,6,.10) 0%,rgba(247,160,6,0) 65%),
    linear-gradient(180deg,#050708 0%,#040607 54%,#030506 100%)!important;
  background-attachment:fixed!important;
}
body:before{
  content:'';
  position:fixed;
  inset:0;
  pointer-events:none;
  z-index:-1;
  background:linear-gradient(90deg,rgba(242,105,8,.06) 0%,transparent 12%,transparent 88%,rgba(242,105,8,.06) 100%);
}

@media (min-width:1301px){
  :root{--page:1594px!important}
  .wrap{width:min(1594px,calc(100% - 78px))!important;max-width:none!important}
  .top{height:74px!important;background:#060809f3!important;border-bottom:1px solid #20262a!important}
  .nav{grid-template-columns:1fr auto 1fr!important;gap:24px!important}
  .brand i{width:42px!important;height:42px!important;box-shadow:0 0 34px rgba(247,160,6,.08)!important}
  .menu a{height:44px!important;padding:0 24px!important}
  .headerStatus{height:44px!important;min-width:158px!important;text-decoration:none!important}
  .headerStatus,.headerStatus *{text-decoration:none!important}

  .hero{
    position:relative!important;
    height:420px!important;
    overflow:hidden!important;
    background:#050708!important;
  }
  .hero:before{
    content:'';
    position:absolute;
    inset:0;
    z-index:0;
    pointer-events:none;
    background:
      linear-gradient(90deg,#050708 0%,rgba(5,7,8,.96) 31%,rgba(5,7,8,.72) 43%,rgba(5,7,8,.10) 62%,rgba(5,7,8,.02) 100%),
      linear-gradient(180deg,rgba(4,6,7,.26) 0%,transparent 16%,transparent 78%,rgba(4,6,7,.58) 100%),
      url('/api/home/art/hero?v=target-final-20260915-1414') center/cover no-repeat;
    opacity:.42;
    filter:saturate(1.14) contrast(1.05) brightness(1.04);
  }
  .hero:after{
    content:'';
    position:absolute;
    inset:0;
    z-index:0;
    pointer-events:none;
    background:
      radial-gradient(circle at 76% 32%,rgba(255,166,55,.15),transparent 26%),
      radial-gradient(circle at 96% 62%,rgba(255,105,7,.10),transparent 30%);
  }
  .heroGrid{position:relative!important;z-index:1!important;height:420px!important;grid-template-columns:38% 62%!important;overflow:visible!important}
  .heroCopy{
    height:420px!important;
    padding:32px 24px 25px 17px!important;
    justify-content:center!important;
    background:linear-gradient(90deg,#050708 0%,#050708 70%,rgba(5,7,8,.97) 81%,rgba(5,7,8,.52) 100%)!important;
    z-index:7!important;
  }
  .ey{font-size:11px!important;letter-spacing:.42em!important;margin-bottom:16px!important;color:#f7a006!important}
  .hero h1{font-size:76px!important;line-height:.86!important;letter-spacing:-.004em!important;text-shadow:0 6px 28px rgba(0,0,0,.24)!important}
  .heroLead{max-width:540px!important;margin-top:17px!important;font-size:15px!important;line-height:1.48!important}
  .heroActions{grid-template-columns:230px 224px 288px!important;gap:14px!important;margin-top:25px!important}
  .heroBtn{height:57px!important}

  .heroVisual{
    height:420px!important;
    margin-left:-44px!important;
    overflow:hidden!important;
    background:#07090a!important;
    z-index:2!important;
    isolation:isolate!important;
    box-shadow:
      inset 42px 0 54px -30px #050708,
      inset -28px 0 42px -30px #050708,
      inset 0 26px 42px -31px #050708,
      inset 0 -34px 44px -30px #050708!important;
  }
  .heroVisual:before{
    content:''!important;
    position:absolute!important;
    inset:0!important;
    z-index:4!important;
    pointer-events:none!important;
    background:
      linear-gradient(90deg,#050708 0%,rgba(5,7,8,.97) 4%,rgba(5,7,8,.68) 10%,rgba(5,7,8,.25) 19%,transparent 31%),
      linear-gradient(270deg,rgba(5,7,8,.44) 0%,rgba(5,7,8,.14) 5%,transparent 11%),
      linear-gradient(180deg,rgba(5,7,8,.33) 0%,rgba(5,7,8,.08) 6%,transparent 14%),
      linear-gradient(0deg,rgba(5,7,8,.76) 0%,rgba(5,7,8,.26) 8%,transparent 20%)!important;
  }
  .heroVisual:after{
    content:''!important;
    position:absolute!important;
    inset:0!important;
    z-index:3!important;
    pointer-events:none!important;
    background:
      radial-gradient(circle at 68% 26%,rgba(255,177,65,.19),transparent 27%),
      radial-gradient(circle at 89% 70%,rgba(255,111,12,.10),transparent 29%)!important;
    mix-blend-mode:screen!important;
  }
  .heroBanner{
    display:block!important;
    visibility:visible!important;
    opacity:1!important;
    position:absolute!important;
    z-index:1!important;
    inset:0!important;
    width:100%!important;
    height:100%!important;
    object-fit:cover!important;
    object-position:center center!important;
    filter:saturate(1.18) contrast(1.08) brightness(1.045)!important;
    transform:none!important;
    animation:none!important;
    image-rendering:auto!important;
    will-change:auto!important;
    backface-visibility:hidden!important;
  }
  .heroGlow{display:none!important}

  .infoStrip{
    padding:0 0 17px!important;
    background:linear-gradient(180deg,rgba(5,7,8,.90) 0%,rgba(4,6,7,.975) 100%)!important;
  }
  .infoGrid{grid-template-columns:1.05fr 1.05fr .93fr 1.05fr!important;gap:15px!important}
  .infoCard{
    height:90px!important;
    padding:15px 17px!important;
    background:linear-gradient(145deg,rgba(12,17,19,.98),rgba(6,10,12,.98))!important;
    border-color:#293238!important;
    box-shadow:inset 0 1px 0 rgba(255,255,255,.02),0 14px 35px rgba(0,0,0,.13)!important;
  }

  .portal{
    padding:0 0 23px!important;
    background:
      radial-gradient(670px 330px at 2% 48%,rgba(179,75,12,.14),transparent 70%),
      radial-gradient(720px 340px at 98% 48%,rgba(226,95,8,.14),transparent 70%),
      linear-gradient(180deg,rgba(4,6,7,.96) 0%,rgba(3,5,6,.99) 100%)!important;
  }
  .portalGrid{grid-template-columns:29% 35.4% 35.6%!important;gap:15px!important}
  .feature{height:246px!important;border-color:#293238!important;box-shadow:0 18px 48px rgba(0,0,0,.23),inset 0 1px 0 rgba(255,255,255,.015)!important}

  .storeCard{
    background:
      radial-gradient(circle at 7% 88%,rgba(255,117,14,.19),transparent 42%),
      linear-gradient(90deg,#0b0d0d 0%,#080c0e 48%,#070a0c 100%)!important;
  }
  .storeArt{
    width:55%!important;
    background-image:url('/api/home/art/store?v=target-final-20260915-1414')!important;
    background-size:cover!important;
    background-position:center!important;
    background-repeat:no-repeat!important;
    filter:saturate(1.14) contrast(1.07) brightness(1.02)!important;
  }
  .storeArt:after{
    content:'';
    position:absolute;
    inset:0;
    pointer-events:none;
    background:
      linear-gradient(90deg,rgba(5,7,8,.03) 0%,rgba(5,7,8,.03) 28%,rgba(5,7,8,.20) 52%,rgba(8,12,14,.68) 76%,#080c0e 100%),
      linear-gradient(180deg,rgba(3,5,6,.25) 0%,transparent 16%,transparent 78%,rgba(3,5,6,.54) 100%);
  }
  .storeCard:after{
    content:'';
    position:absolute;
    inset:0;
    pointer-events:none;
    z-index:2;
    background:radial-gradient(circle at 19% 80%,rgba(255,139,27,.15),transparent 34%);
  }
  .crate{display:none!important}
  .storeCopy{left:45%!important;top:38px!important;z-index:4!important}

  .communityCard{
    padding:27px 31px!important;
    background-image:
      linear-gradient(90deg,rgba(5,7,8,.97) 0%,rgba(5,7,8,.88) 37%,rgba(5,7,8,.58) 61%,rgba(5,7,8,.25) 100%),
      linear-gradient(180deg,rgba(3,5,6,.12),rgba(3,5,6,.35)),
      url('/api/home/art/community?v=target-final-20260915-1414')!important;
    background-size:cover!important;
    background-position:center!important;
    background-repeat:no-repeat!important;
  }
  .communityCard>*{position:relative;z-index:3}
  .communityCard:after{
    content:''!important;
    position:absolute!important;
    inset:0!important;
    width:auto!important;
    height:auto!important;
    right:auto!important;
    bottom:auto!important;
    background:
      radial-gradient(circle at 88% 72%,rgba(255,135,16,.17),transparent 43%),
      linear-gradient(180deg,rgba(4,6,7,.18) 0%,transparent 18%,transparent 74%,rgba(4,6,7,.50) 100%)!important;
    pointer-events:none!important;
    z-index:1!important;
  }
  .communityStats{
    border-top:0!important;
    left:22px!important;
    right:22px!important;
    bottom:14px!important;
    padding:11px 13px 0!important;
    background:linear-gradient(90deg,rgba(4,6,7,.42),rgba(4,6,7,.18),rgba(4,6,7,.04))!important;
    backdrop-filter:blur(1px)!important;
  }
  .communityStats:before,.communityStats:after{display:none!important}
  .communityCard hr{display:none!important}

  .footer{
    height:75px!important;
    background:linear-gradient(180deg,rgba(4,6,7,.985),#030506)!important;
    border-top-color:#252d31!important;
  }
}

.heroVisual.reveal{filter:none!important}
.heroVisual.reveal.in{opacity:1!important;filter:none!important}
.heroVisual .heroBanner{pointer-events:none!important}
.heroBanner{animation:none!important;transform:none!important}

@media (min-width:1500px){.hero h1{font-size:78px!important}}
@media (max-width:1300px){
  .heroBanner{content:url('/api/home/art/hero?v=target-final-20260915-1414')!important;animation:none!important;transform:none!important;filter:saturate(1.16) contrast(1.07) brightness(1.035)!important}
  .heroVisual:before{background:linear-gradient(90deg,#050708 0%,rgba(5,7,8,.86) 6%,rgba(5,7,8,.30) 19%,transparent 31%),linear-gradient(270deg,rgba(5,7,8,.31),transparent 9%),linear-gradient(180deg,rgba(5,7,8,.24),transparent 12%),linear-gradient(0deg,rgba(5,7,8,.66),transparent 18%)!important}
  .infoStrip{background:linear-gradient(180deg,rgba(5,7,8,.92),rgba(4,6,7,.98))!important}
  .portal{background:radial-gradient(620px 260px at 4% 45%,rgba(179,75,12,.10),transparent 65%),radial-gradient(620px 260px at 96% 45%,rgba(226,95,8,.10),transparent 65%),linear-gradient(180deg,rgba(4,6,7,.96),rgba(3,5,6,.99))!important}
  .storeArt{background-image:url('/api/home/art/store?v=target-final-20260915-1414')!important;background-size:cover!important;background-position:center!important;filter:saturate(1.10) contrast(1.05)!important}
  .storeArt:after{content:'';position:absolute;inset:0;background:linear-gradient(90deg,rgba(5,7,8,.02),rgba(5,7,8,.12) 43%,rgba(8,12,14,.72) 100%);pointer-events:none}
  .crate{display:none!important}
  .communityCard{background-image:linear-gradient(90deg,rgba(5,7,8,.96),rgba(5,7,8,.51)),url('/api/home/art/community?v=target-final-20260915-1414')!important;background-size:cover!important;background-position:center!important}
  .communityStats{border-top:0!important;background:rgba(4,6,7,.16)!important}
  .communityCard hr{display:none!important}
}
</style>`;

  return base.replace("</head>", `${mockupCss}</head>`);
}

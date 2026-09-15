import type { Request } from "express";
import { renderHome as renderBaseHome } from "./homePage.js";

export function renderHome(req: Request): string {
  const base = renderBaseHome(req)
    .replace('src="/api/home/banner"', 'src="/api/home/art/hero?v=final-fade-20260915"');

  const css = `<style id="gf-home-final-fade">
:root{--page:1594px!important;--gf-bg:#030506;--gf-orange:#f7a006}
html{background:#030506!important}
body{
  margin:0!important;
  background:
    radial-gradient(1050px 760px at -7% 34%,rgba(255,104,0,.18) 0%,rgba(255,104,0,.07) 28%,transparent 68%),
    radial-gradient(1080px 760px at 107% 36%,rgba(255,116,0,.18) 0%,rgba(255,116,0,.07) 29%,transparent 69%),
    radial-gradient(920px 420px at 50% 0%,rgba(255,147,25,.06) 0%,transparent 72%),
    linear-gradient(180deg,#050708 0%,#040607 48%,#030506 100%)!important;
  background-attachment:fixed!important;
}
body:before{
  content:'';position:fixed;inset:0;z-index:-1;pointer-events:none;
  background:linear-gradient(90deg,rgba(210,77,7,.07),transparent 13%,transparent 87%,rgba(210,77,7,.07));
}
@media (min-width:1301px){
  .wrap{width:min(1594px,calc(100% - 78px))!important;max-width:none!important}
  .top{height:74px!important;background:rgba(4,7,8,.97)!important;border-bottom:1px solid #20262a!important;backdrop-filter:blur(14px)!important}
  .headerStatus,.headerStatus *{text-decoration:none!important}

  .hero{position:relative!important;height:438px!important;overflow:hidden!important;background:transparent!important}
  .hero:before{
    content:'';position:absolute;inset:-80px -120px -95px;z-index:0;pointer-events:none;
    background:
      radial-gradient(ellipse at 53% 50%,rgba(244,108,8,.16) 0%,rgba(244,108,8,.08) 36%,transparent 68%),
      linear-gradient(180deg,transparent 64%,rgba(3,5,6,.96) 100%);
    filter:blur(20px);
  }
  .heroGrid{position:relative!important;display:block!important;height:438px!important;overflow:visible!important}
  .heroVisual{position:absolute!important;z-index:1!important;inset:0!important;width:100%!important;height:438px!important;margin:0!important;overflow:hidden!important;background:#050708!important}
  .heroBanner{position:absolute!important;inset:0!important;width:100%!important;height:100%!important;display:block!important;object-fit:cover!important;object-position:center 48%!important;filter:saturate(1.06) contrast(1.045) brightness(.98)!important;transform:none!important;animation:none!important;image-rendering:auto!important;backface-visibility:hidden!important}
  .heroVisual:before{
    content:''!important;position:absolute!important;inset:0!important;z-index:4!important;pointer-events:none!important;
    background:
      linear-gradient(90deg,#050708 0%,rgba(5,7,8,.99) 7%,rgba(5,7,8,.92) 16%,rgba(5,7,8,.70) 28%,rgba(5,7,8,.38) 40%,rgba(5,7,8,.12) 52%,transparent 62%),
      linear-gradient(270deg,rgba(3,5,6,.66) 0%,rgba(3,5,6,.32) 5%,rgba(3,5,6,.08) 11%,transparent 18%),
      linear-gradient(180deg,rgba(3,5,6,.30) 0%,rgba(3,5,6,.08) 8%,transparent 15%),
      linear-gradient(0deg,#030506 0%,rgba(3,5,6,.96) 4%,rgba(3,5,6,.78) 10%,rgba(3,5,6,.42) 17%,rgba(3,5,6,.14) 24%,transparent 34%)!important;
  }
  .heroVisual:after{
    content:''!important;position:absolute!important;inset:0!important;z-index:3!important;pointer-events:none!important;
    background:
      radial-gradient(circle at 82% 44%,rgba(255,151,35,.12),transparent 29%),
      radial-gradient(ellipse at 50% 102%,rgba(237,95,6,.11),transparent 48%)!important;
    box-shadow:inset 0 0 72px rgba(0,0,0,.30)!important;
  }
  .heroGlow{display:none!important}
  .heroCopy{position:relative!important;z-index:6!important;width:47%!important;height:438px!important;padding:35px 24px 28px 17px!important;display:flex!important;flex-direction:column!important;justify-content:center!important;background:transparent!important}
  .heroCopy:after{content:'';position:absolute;inset:0 -90px 0 0;z-index:-1;pointer-events:none;background:linear-gradient(90deg,#050708 0%,#050708 66%,rgba(5,7,8,.84) 79%,rgba(5,7,8,.38) 91%,transparent 100%)}
  .ey{font-size:11px!important;letter-spacing:.42em!important;margin-bottom:16px!important;color:#f7a006!important}
  .hero h1{font-size:75px!important;line-height:.86!important;letter-spacing:-.004em!important;text-shadow:0 8px 34px rgba(0,0,0,.45)!important}
  .heroLead{max-width:545px!important;margin-top:18px!important;font-size:15px!important;line-height:1.48!important;color:#a7adb1!important;text-shadow:0 2px 10px rgba(0,0,0,.72)!important}
  .heroActions{grid-template-columns:230px 224px 288px!important;gap:14px!important;margin-top:25px!important}.heroBtn{height:57px!important;backdrop-filter:blur(4px)!important;background:rgba(7,11,13,.86)!important}.heroBtn.primary{background:#f7a006!important}

  .infoStrip{position:relative!important;padding:0 0 17px!important;background:linear-gradient(180deg,rgba(3,5,6,.98),#040607)!important}
  .infoStrip:before{content:''!important;position:absolute!important;left:0!important;right:0!important;top:-78px!important;height:78px!important;pointer-events:none!important;background:linear-gradient(180deg,transparent 0%,rgba(3,5,6,.38) 35%,rgba(3,5,6,.82) 72%,#030506 100%)!important}
  .infoGrid{grid-template-columns:1.05fr 1.05fr .93fr 1.05fr!important;gap:15px!important}.infoCard{height:90px!important;padding:15px 17px!important;background:linear-gradient(145deg,rgba(12,17,19,.985),rgba(6,10,12,.985))!important;border-color:#293238!important}

  .portal{position:relative!important;padding:0 0 23px!important;background:radial-gradient(620px 310px at -3% 55%,rgba(175,69,13,.10),transparent 72%),radial-gradient(660px 330px at 103% 53%,rgba(199,74,8,.11),transparent 72%),linear-gradient(180deg,#040607,#030506)!important}.portalGrid{grid-template-columns:29% 35.4% 35.6%!important;gap:15px!important}.feature{height:246px!important;border-color:#293238!important}
  .storeCard{overflow:hidden!important;background:linear-gradient(90deg,#0b0d0d,#080c0e 55%,#070a0c)!important}.storeArt{width:56%!important;background-image:url('/api/home/art/store?v=final-fade-20260915')!important;background-size:cover!important;background-position:center!important;background-repeat:no-repeat!important}.storeArt:after{content:''!important;position:absolute!important;inset:0!important;pointer-events:none!important;background:linear-gradient(90deg,rgba(5,7,8,.02),rgba(5,7,8,.03) 28%,rgba(5,7,8,.20) 50%,rgba(8,12,14,.68) 77%,#080c0e)!important}.crate{display:none!important}.storeCopy{left:45%!important;top:38px!important;z-index:4!important}
  .communityCard{padding:27px 31px!important;background-image:linear-gradient(90deg,rgba(5,7,8,.975),rgba(5,7,8,.88) 39%,rgba(5,7,8,.56) 63%,rgba(5,7,8,.25)),url('/api/home/art/community?v=final-fade-20260915')!important;background-size:cover!important;background-position:center!important;background-repeat:no-repeat!important}.communityCard>*{position:relative!important;z-index:3!important}.communityCard:after{content:''!important;position:absolute!important;inset:0!important;z-index:1!important;pointer-events:none!important;background:radial-gradient(circle at 90% 72%,rgba(255,125,15,.11),transparent 42%),linear-gradient(180deg,rgba(4,6,7,.15),transparent 18%,transparent 74%,rgba(4,6,7,.48))!important}.communityStats{border-top:0!important;left:22px!important;right:22px!important;bottom:14px!important;padding:11px 13px 0!important;background:linear-gradient(90deg,rgba(4,6,7,.38),rgba(4,6,7,.17),rgba(4,6,7,.03))!important}.communityStats:before,.communityStats:after,.communityCard hr{display:none!important}.footer{height:75px!important;background:linear-gradient(180deg,rgba(4,6,7,.99),#030506)!important}
}
.heroVisual.reveal,.heroVisual.reveal.in{filter:none!important;opacity:1!important}.heroBanner{animation:none!important}.heroVisual .heroBanner{pointer-events:none!important}
@media (min-width:1600px){.hero h1{font-size:78px!important}}
@media (max-width:1300px){body{background:linear-gradient(180deg,#050708,#030506)!important}.heroBanner{content:url('/api/home/art/hero?v=final-fade-20260915')!important;animation:none!important;transform:none!important}.communityStats{border-top:0!important}.communityCard hr{display:none!important}}
</style>`;

  return base.replace("</head>", `${css}</head>`);
}

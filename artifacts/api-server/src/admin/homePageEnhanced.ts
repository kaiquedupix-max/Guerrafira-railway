import type { Request } from "express";
import { renderHome as renderBaseHome } from "./homePage.js";

/** Home Guerra Fria: arte final enviada pelo usuario + integracao cinematografica do fundo. */
export function renderHome(req: Request): string {
  const base = renderBaseHome(req)
    .replace('src="/api/home/banner"', 'src="/api/home/art/hero?v=user-hero-final-v8-20260915"');

  const css = `<style id="gf-home-user-hero-v8">
:root{--page:1594px!important;--gf-bg:#030506;--gf-warm:#d8660b;--gf-orange:#f7a006}
html{background:#030506!important}
body{
  margin:0!important;
  background:
    radial-gradient(920px 720px at -7% 37%,rgba(226,92,8,.16) 0%,rgba(226,92,8,.065) 30%,rgba(226,92,8,0) 69%),
    radial-gradient(980px 740px at 107% 39%,rgba(244,109,9,.17) 0%,rgba(244,109,9,.07) 30%,rgba(244,109,9,0) 69%),
    radial-gradient(1150px 440px at 59% 8%,rgba(255,148,28,.055) 0%,rgba(255,148,28,0) 72%),
    linear-gradient(180deg,#050708 0%,#040607 52%,#030506 100%)!important;
  background-attachment:fixed!important;
}
body:before{
  content:'';
  position:fixed;
  inset:0;
  z-index:-1;
  pointer-events:none;
  background:linear-gradient(90deg,rgba(224,81,6,.055),transparent 12%,transparent 88%,rgba(224,81,6,.06));
}

@media (min-width:1301px){
  .wrap{width:min(1594px,calc(100% - 78px))!important;max-width:none!important}
  .top{height:74px!important;background:rgba(4,7,8,.97)!important;border-bottom:1px solid #20262a!important;backdrop-filter:blur(14px)!important}
  .headerStatus,.headerStatus *{text-decoration:none!important}

  .hero{
    position:relative!important;
    height:438px!important;
    overflow:hidden!important;
    isolation:isolate!important;
    background:
      radial-gradient(780px 390px at 100% 48%,rgba(219,83,7,.11),transparent 68%),
      radial-gradient(620px 340px at 0% 48%,rgba(187,66,7,.075),transparent 70%),
      #050708!important;
  }
  .hero:after{
    content:'';
    position:absolute;
    z-index:9;
    left:0;right:0;bottom:-1px;
    height:76px;
    pointer-events:none;
    background:linear-gradient(180deg,rgba(4,6,7,0),rgba(4,6,7,.56) 55%,#040607 100%);
  }
  .heroGrid{position:relative!important;display:block!important;height:438px!important;overflow:visible!important}

  /* A imagem enviada pelo usuario e o fundo real de todo o hero. */
  .heroVisual{
    position:absolute!important;
    z-index:1!important;
    inset:0!important;
    width:100%!important;
    height:438px!important;
    margin:0!important;
    overflow:hidden!important;
    background:#050708!important;
  }
  .heroBanner{
    position:absolute!important;
    inset:0!important;
    width:100%!important;
    height:100%!important;
    display:block!important;
    visibility:visible!important;
    opacity:1!important;
    object-fit:cover!important;
    object-position:center center!important;
    filter:saturate(1.08) contrast(1.045) brightness(1.01)!important;
    transform:none!important;
    animation:none!important;
    image-rendering:auto!important;
    backface-visibility:hidden!important;
  }
  /* Escurece apenas onde o texto precisa respirar e dissolve as quatro bordas. */
  .heroVisual:before{
    content:''!important;
    position:absolute!important;
    inset:0!important;
    z-index:5!important;
    pointer-events:none!important;
    background:
      linear-gradient(90deg,#050708 0%,rgba(5,7,8,.99) 8%,rgba(5,7,8,.93) 18%,rgba(5,7,8,.76) 29%,rgba(5,7,8,.48) 40%,rgba(5,7,8,.18) 51%,rgba(5,7,8,.035) 59%,transparent 65%),
      linear-gradient(270deg,rgba(4,6,7,.56) 0%,rgba(4,6,7,.18) 7%,rgba(4,6,7,.025) 13%,transparent 19%),
      linear-gradient(180deg,rgba(4,6,7,.35) 0%,rgba(4,6,7,.07) 8%,transparent 16%),
      linear-gradient(0deg,rgba(4,6,7,.90) 0%,rgba(4,6,7,.42) 9%,rgba(4,6,7,.10) 17%,transparent 25%)!important;
  }
  .heroVisual:after{
    content:''!important;
    position:absolute!important;
    inset:0!important;
    z-index:4!important;
    pointer-events:none!important;
    background:
      radial-gradient(circle at 82% 46%,rgba(255,151,34,.085),transparent 31%),
      radial-gradient(circle at 98% 50%,rgba(255,102,7,.075),transparent 30%)!important;
    box-shadow:inset 0 0 84px rgba(0,0,0,.24)!important;
  }
  .heroGlow{display:none!important}

  .heroCopy{
    position:relative!important;
    z-index:7!important;
    width:47%!important;
    height:438px!important;
    padding:34px 24px 28px 17px!important;
    display:flex!important;
    flex-direction:column!important;
    justify-content:center!important;
    background:transparent!important;
  }
  .ey{font-size:11px!important;letter-spacing:.42em!important;margin-bottom:16px!important;color:#f7a006!important;text-shadow:0 2px 10px #000!important}
  .hero h1{font-size:76px!important;line-height:.86!important;letter-spacing:-.004em!important;text-shadow:0 7px 30px rgba(0,0,0,.58)!important}
  .heroLead{max-width:548px!important;margin-top:17px!important;font-size:15px!important;line-height:1.48!important;color:#b0b6ba!important;text-shadow:0 2px 11px rgba(0,0,0,.92)!important}
  .heroActions{grid-template-columns:230px 224px 288px!important;gap:14px!important;margin-top:25px!important}
  .heroBtn{height:57px!important;background:rgba(7,11,13,.88)!important;backdrop-filter:blur(7px)!important;box-shadow:0 10px 28px rgba(0,0,0,.16)!important}
  .heroBtn.primary{background:#f7a006!important;box-shadow:0 11px 30px rgba(247,160,6,.10)!important}

  /* Faz o fundo do site continuar a paleta do banner, sem corte seco. */
  .infoStrip{
    position:relative!important;
    z-index:10!important;
    padding:0 0 17px!important;
    background:
      radial-gradient(520px 130px at 100% 0%,rgba(218,82,8,.055),transparent 72%),
      linear-gradient(180deg,rgba(4,6,7,.99),#040607)!important;
  }
  .infoStrip:before{
    content:''!important;
    position:absolute!important;
    left:0!important;right:0!important;top:-76px!important;height:76px!important;
    pointer-events:none!important;
    background:linear-gradient(180deg,transparent 0%,rgba(4,6,7,.56) 52%,#040607 100%)!important;
  }
  .infoGrid{grid-template-columns:1.05fr 1.05fr .93fr 1.05fr!important;gap:15px!important}
  .infoCard{height:90px!important;padding:15px 17px!important;background:linear-gradient(145deg,rgba(12,17,19,.99),rgba(6,10,12,.99))!important;border-color:#293238!important;box-shadow:inset 0 1px rgba(255,255,255,.018),0 15px 34px rgba(0,0,0,.12)!important}

  .portal{
    position:relative!important;
    padding:0 0 23px!important;
    background:
      radial-gradient(660px 330px at -4% 48%,rgba(189,69,10,.10),transparent 72%),
      radial-gradient(700px 350px at 104% 48%,rgba(211,79,8,.11),transparent 72%),
      linear-gradient(180deg,#040607,#030506)!important;
  }
  .portalGrid{grid-template-columns:29% 35.4% 35.6%!important;gap:15px!important}
  .feature{height:246px!important;border-color:#293238!important;box-shadow:0 18px 44px rgba(0,0,0,.20),inset 0 1px rgba(255,255,255,.015)!important}

  .storeCard{overflow:hidden!important;background:linear-gradient(90deg,#0b0d0d,#080c0e 55%,#070a0c)!important}
  .storeArt{width:56%!important;background-image:url('/api/home/art/store?v=user-hero-final-v8-20260915')!important;background-size:cover!important;background-position:center!important;background-repeat:no-repeat!important;filter:saturate(1.07) contrast(1.04)!important}
  .storeArt:after{content:''!important;position:absolute!important;inset:0!important;pointer-events:none!important;background:linear-gradient(90deg,rgba(5,7,8,.02),rgba(5,7,8,.02) 27%,rgba(5,7,8,.20) 50%,rgba(8,12,14,.69) 77%,#080c0e 100%),linear-gradient(180deg,rgba(3,5,6,.20),transparent 17%,transparent 78%,rgba(3,5,6,.43))!important}
  .storeCard:before{content:''!important;position:absolute!important;inset:0!important;z-index:2!important;pointer-events:none!important;background:radial-gradient(circle at 15% 84%,rgba(255,132,24,.11),transparent 34%)!important}
  .crate{display:none!important}.storeCopy{left:45%!important;top:38px!important;z-index:4!important}

  .communityCard{padding:27px 31px!important;background-image:linear-gradient(90deg,rgba(5,7,8,.975),rgba(5,7,8,.87) 39%,rgba(5,7,8,.54) 63%,rgba(5,7,8,.22)),url('/api/home/art/community?v=user-hero-final-v8-20260915')!important;background-size:cover!important;background-position:center!important;background-repeat:no-repeat!important}
  .communityCard>*{position:relative!important;z-index:3!important}
  .communityCard:after{content:''!important;position:absolute!important;inset:0!important;z-index:1!important;pointer-events:none!important;background:radial-gradient(circle at 90% 72%,rgba(255,125,15,.12),transparent 42%),linear-gradient(180deg,rgba(4,6,7,.14),transparent 18%,transparent 74%,rgba(4,6,7,.49))!important}
  .communityStats{border-top:0!important;left:22px!important;right:22px!important;bottom:14px!important;padding:11px 13px 0!important;background:linear-gradient(90deg,rgba(4,6,7,.38),rgba(4,6,7,.16),rgba(4,6,7,.025))!important}
  .communityStats:before,.communityStats:after,.communityCard hr{display:none!important}

  .footer{height:75px!important;background:linear-gradient(180deg,rgba(4,6,7,.995),#030506)!important;border-top-color:#252d31!important}
}

.heroVisual.reveal,.heroVisual.reveal.in{filter:none!important;opacity:1!important}
.heroBanner{animation:none!important;transform:none!important}
.heroVisual .heroBanner{pointer-events:none!important}

@media (min-width:1600px){.hero h1{font-size:78px!important}}
@media (max-width:1300px){
  body{background:linear-gradient(180deg,#050708,#030506)!important}
  .heroBanner{content:url('/api/home/art/hero?v=user-hero-final-v8-20260915')!important;animation:none!important;transform:none!important}
  .communityStats{border-top:0!important}.communityCard hr{display:none!important}
}
</style>`;

  return base.replace("</head>", `${css}</head>`);
}

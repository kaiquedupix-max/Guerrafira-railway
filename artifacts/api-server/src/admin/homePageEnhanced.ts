import type { Request } from "express";
import { renderHome as renderBaseHome } from "./homePage.js";

/** Visual final da Home Guerra Fria, preservando toda a logica/dados da home base. */
export function renderHome(req: Request): string {
  const base = renderBaseHome(req)
    .replace('src="/api/home/banner"', 'src="/api/home/art/hero?v=gf-user-final-20260915-1508"');

  const css = `<style id="gf-home-final-user-art">
:root{--page:1594px!important;--gf-bg:#040607;--gf-panel:#080c0e;--gf-orange:#f7a006}
html{background:#030506!important}
body{
  margin:0!important;
  background:
    radial-gradient(880px 650px at -8% 44%,rgba(255,116,14,.18) 0%,rgba(255,116,14,.075) 29%,rgba(255,116,14,0) 68%),
    radial-gradient(920px 680px at 108% 42%,rgba(255,123,12,.19) 0%,rgba(255,123,12,.08) 29%,rgba(255,123,12,0) 69%),
    radial-gradient(900px 360px at 56% 1%,rgba(255,154,29,.055) 0%,rgba(255,154,29,0) 70%),
    linear-gradient(180deg,#050708 0%,#040607 56%,#030506 100%)!important;
  background-attachment:fixed!important;
}
body:before{
  content:'';
  position:fixed;
  inset:0;
  pointer-events:none;
  z-index:-1;
  background:
    linear-gradient(90deg,rgba(211,78,7,.08) 0%,rgba(211,78,7,0) 12%,rgba(211,78,7,0) 88%,rgba(211,78,7,.08) 100%);
}

@media (min-width:1301px){
  .wrap{width:min(1594px,calc(100% - 76px))!important;max-width:none!important}
  .top{height:74px!important;background:rgba(4,7,8,.97)!important;border-bottom:1px solid #20262a!important;backdrop-filter:blur(12px)!important}
  .nav{grid-template-columns:1fr auto 1fr!important;gap:24px!important}
  .brand i{width:42px!important;height:42px!important}
  .menu a{height:44px!important;padding:0 24px!important}
  .headerStatus{height:44px!important;min-width:158px!important;text-decoration:none!important}
  .headerStatus,.headerStatus *{text-decoration:none!important}

  .hero{
    position:relative!important;
    height:432px!important;
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
      radial-gradient(520px 330px at 1% 49%,rgba(235,92,8,.10),transparent 72%),
      radial-gradient(600px 350px at 99% 48%,rgba(255,110,9,.10),transparent 72%);
  }
  .heroGrid{position:relative!important;display:block!important;height:432px!important;overflow:hidden!important}

  /* A arte enviada pelo usuario ocupa o lado direito inteiro. */
  .heroVisual{
    position:absolute!important;
    z-index:2!important;
    top:0!important;
    right:0!important;
    bottom:0!important;
    left:31.5%!important;
    height:432px!important;
    margin:0!important;
    overflow:hidden!important;
    background:#050708!important;
    isolation:isolate!important;
  }
  .heroBanner{
    position:absolute!important;
    inset:0!important;
    width:100%!important;
    height:100%!important;
    display:block!important;
    opacity:1!important;
    visibility:visible!important;
    object-fit:cover!important;
    object-position:center center!important;
    filter:saturate(1.10) contrast(1.055) brightness(1.015)!important;
    transform:none!important;
    animation:none!important;
    image-rendering:auto!important;
    backface-visibility:hidden!important;
  }
  /* Fade nas quatro bordas para a imagem realmente se fundir ao fundo. */
  .heroVisual:before{
    content:''!important;
    position:absolute!important;
    inset:0!important;
    z-index:5!important;
    pointer-events:none!important;
    background:
      linear-gradient(90deg,#050708 0%,rgba(5,7,8,.995) 3%,rgba(5,7,8,.88) 9%,rgba(5,7,8,.57) 17%,rgba(5,7,8,.24) 25%,rgba(5,7,8,.05) 31%,transparent 36%),
      linear-gradient(270deg,rgba(4,6,7,.68) 0%,rgba(4,6,7,.28) 5%,rgba(4,6,7,.06) 11%,transparent 17%),
      linear-gradient(180deg,rgba(4,6,7,.43) 0%,rgba(4,6,7,.10) 7%,transparent 15%),
      linear-gradient(0deg,rgba(4,6,7,.92) 0%,rgba(4,6,7,.45) 8%,rgba(4,6,7,.12) 15%,transparent 23%)!important;
  }
  .heroVisual:after{
    content:''!important;
    position:absolute!important;
    inset:0!important;
    z-index:4!important;
    pointer-events:none!important;
    background:
      radial-gradient(circle at 76% 48%,rgba(255,167,50,.09),transparent 28%),
      radial-gradient(circle at 96% 50%,rgba(255,102,7,.075),transparent 31%)!important;
    mix-blend-mode:screen!important;
  }
  .heroGlow{display:none!important}

  /* Texto sobre o fade esquerdo, como no mockup. */
  .heroCopy{
    position:relative!important;
    z-index:8!important;
    width:40.5%!important;
    height:432px!important;
    padding:34px 23px 27px 17px!important;
    justify-content:center!important;
    background:linear-gradient(90deg,#050708 0%,#050708 72%,rgba(5,7,8,.94) 84%,rgba(5,7,8,.53) 93%,rgba(5,7,8,0) 100%)!important;
  }
  .ey{font-size:11px!important;letter-spacing:.42em!important;margin-bottom:16px!important;color:#f7a006!important}
  .hero h1{font-size:77px!important;line-height:.86!important;letter-spacing:-.005em!important;text-shadow:0 5px 25px rgba(0,0,0,.35)!important}
  .heroLead{max-width:550px!important;margin-top:17px!important;font-size:15px!important;line-height:1.48!important;color:#c1c7ca!important}
  .heroActions{grid-template-columns:230px 224px 288px!important;gap:14px!important;margin-top:25px!important}
  .heroBtn{height:57px!important}

  .infoStrip{
    position:relative!important;
    padding:0 0 17px!important;
    background:linear-gradient(180deg,rgba(4,6,7,.95),rgba(4,6,7,.995))!important;
  }
  .infoStrip:before{
    content:'';
    position:absolute;
    left:0;right:0;top:-54px;height:54px;
    pointer-events:none;
    background:linear-gradient(180deg,transparent,rgba(4,6,7,.98));
  }
  .infoGrid{grid-template-columns:1.05fr 1.05fr .93fr 1.05fr!important;gap:15px!important}
  .infoCard{height:90px!important;padding:15px 17px!important;background:linear-gradient(145deg,rgba(12,17,19,.99),rgba(6,10,12,.99))!important;border-color:#293238!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.018),0 16px 36px rgba(0,0,0,.16)!important}

  .portal{
    position:relative!important;
    padding:0 0 23px!important;
    background:
      radial-gradient(610px 300px at -2% 52%,rgba(207,82,11,.105),transparent 72%),
      radial-gradient(650px 320px at 102% 51%,rgba(222,88,10,.11),transparent 72%),
      linear-gradient(180deg,rgba(4,6,7,.995),#030506)!important;
  }
  .portalGrid{grid-template-columns:29% 35.4% 35.6%!important;gap:15px!important}
  .feature{height:246px!important;border-color:#293238!important;box-shadow:0 18px 46px rgba(0,0,0,.24),inset 0 1px 0 rgba(255,255,255,.015)!important}

  .storeCard{overflow:hidden!important;background:linear-gradient(90deg,#0a0d0e 0%,#080c0e 57%,#070a0c 100%)!important}
  .storeArt{width:56%!important;background-image:url('/api/home/art/store?v=gf-final-20260915')!important;background-size:cover!important;background-position:center!important;background-repeat:no-repeat!important;filter:saturate(1.10) contrast(1.055) brightness(1.015)!important}
  .storeArt:after{content:'';position:absolute;inset:0;pointer-events:none;background:linear-gradient(90deg,rgba(5,7,8,.02),rgba(5,7,8,.03) 27%,rgba(5,7,8,.20) 50%,rgba(8,12,14,.69) 77%,#080c0e 100%),linear-gradient(180deg,rgba(3,5,6,.24),transparent 16%,transparent 78%,rgba(3,5,6,.50))}
  .storeCard:after{content:'';position:absolute;inset:0;z-index:2;pointer-events:none;background:radial-gradient(circle at 18% 82%,rgba(255,132,24,.12),transparent 36%)}
  .crate{display:none!important}
  .storeCopy{left:45%!important;top:38px!important;z-index:4!important}

  .communityCard{padding:27px 31px!important;background-image:linear-gradient(90deg,rgba(5,7,8,.975) 0%,rgba(5,7,8,.88) 39%,rgba(5,7,8,.56) 63%,rgba(5,7,8,.23) 100%),linear-gradient(180deg,rgba(3,5,6,.10),rgba(3,5,6,.36)),url('/api/home/art/community?v=gf-final-20260915')!important;background-size:cover!important;background-position:center!important;background-repeat:no-repeat!important}
  .communityCard>*{position:relative!important;z-index:3!important}
  .communityCard:after{content:''!important;position:absolute!important;inset:0!important;z-index:1!important;pointer-events:none!important;background:radial-gradient(circle at 90% 72%,rgba(255,125,15,.12),transparent 42%),linear-gradient(180deg,rgba(4,6,7,.15),transparent 18%,transparent 74%,rgba(4,6,7,.50))!important}
  .communityStats{border-top:0!important;left:22px!important;right:22px!important;bottom:14px!important;padding:11px 13px 0!important;background:linear-gradient(90deg,rgba(4,6,7,.40),rgba(4,6,7,.17),rgba(4,6,7,.03))!important}
  .communityStats:before,.communityStats:after,.communityCard hr{display:none!important}

  .footer{height:75px!important;background:linear-gradient(180deg,rgba(4,6,7,.995),#030506)!important;border-top-color:#252d31!important}
}

.heroVisual.reveal{filter:none!important}
.heroVisual.reveal.in{opacity:1!important;filter:none!important}
.heroVisual .heroBanner{pointer-events:none!important}
.heroBanner{animation:none!important;transform:none!important}

@media (min-width:1500px){.hero h1{font-size:78px!important}}
@media (max-width:1300px){
  body{background:linear-gradient(180deg,#050708,#030506)!important}
  .heroBanner{content:url('/api/home/art/hero?v=gf-user-final-20260915-1508')!important;animation:none!important;transform:none!important}
  .communityStats{border-top:0!important}
  .communityCard hr{display:none!important}
}
</style>`;

  return base.replace("</head>", `${css}</head>`);
}

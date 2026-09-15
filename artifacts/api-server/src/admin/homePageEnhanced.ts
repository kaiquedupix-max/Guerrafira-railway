import type { Request } from "express";
import { renderHome as renderBaseHome } from "./homePage.js";

/** Home Guerra Fria: usa o banner aprovado pelo usuário e integra a arte ao fundo. */
export function renderHome(req: Request): string {
  const base = renderBaseHome(req)
    .replace('src="/api/home/banner"', 'src="/api/home/art/hero?v=user-banner-final-20260915"');

  const css = `<style id="gf-home-user-banner-final">
:root{--page:1594px!important;--gf-bg:#040607;--gf-panel:#080c0e;--gf-orange:#f7a006}
html{background:#040607!important}
body{
  margin:0!important;
  background:
    radial-gradient(780px 520px at -6% 43%,rgba(255,112,14,.11) 0%,rgba(255,112,14,.045) 34%,transparent 72%),
    radial-gradient(820px 540px at 106% 45%,rgba(255,116,13,.12) 0%,rgba(255,116,13,.05) 33%,transparent 72%),
    radial-gradient(900px 420px at 73% 5%,rgba(247,160,6,.055) 0%,transparent 70%),
    linear-gradient(180deg,#050708 0%,#040607 52%,#030506 100%)!important;
  background-attachment:fixed!important;
}

@media (min-width:1301px){
  .wrap{width:min(1594px,calc(100% - 78px))!important;max-width:none!important}
  .top{height:74px!important;background:rgba(5,8,9,.97)!important;border-bottom:1px solid #20262a!important;backdrop-filter:blur(12px)!important}
  .nav{grid-template-columns:1fr auto 1fr!important;gap:24px!important}
  .brand i{width:42px!important;height:42px!important}
  .menu a{height:44px!important;padding:0 24px!important}
  .headerStatus{height:44px!important;min-width:158px!important;text-decoration:none!important}
  .headerStatus,.headerStatus *{text-decoration:none!important}

  /* HERO: o banner aprovado ocupa a área principal e desaparece no preto pelas bordas. */
  .hero{
    position:relative!important;
    height:420px!important;
    overflow:hidden!important;
    background:
      radial-gradient(circle at 83% 39%,rgba(255,145,36,.08),transparent 35%),
      #050708!important;
  }
  .heroGrid{position:relative!important;display:block!important;height:420px!important;overflow:hidden!important}
  .heroCopy{
    position:relative!important;
    z-index:6!important;
    width:44%!important;
    height:420px!important;
    padding:32px 24px 25px 17px!important;
    justify-content:center!important;
    background:
      linear-gradient(90deg,#050708 0%,#050708 61%,rgba(5,7,8,.985) 76%,rgba(5,7,8,.72) 89%,rgba(5,7,8,0) 100%)!important;
  }
  .heroVisual{
    position:absolute!important;
    z-index:2!important;
    top:0!important;
    right:0!important;
    bottom:0!important;
    left:34%!important;
    height:420px!important;
    margin:0!important;
    overflow:hidden!important;
    isolation:isolate!important;
    background:#050708!important;
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
    filter:saturate(1.08) contrast(1.045) brightness(1.015)!important;
    transform:none!important;
    animation:none!important;
    image-rendering:auto!important;
    backface-visibility:hidden!important;
  }
  .heroVisual:before{
    content:''!important;
    position:absolute!important;
    inset:0!important;
    z-index:4!important;
    pointer-events:none!important;
    background:
      linear-gradient(90deg,#050708 0%,rgba(5,7,8,.98) 4%,rgba(5,7,8,.82) 10%,rgba(5,7,8,.46) 18%,rgba(5,7,8,.16) 25%,transparent 34%),
      linear-gradient(270deg,rgba(4,6,7,.55) 0%,rgba(4,6,7,.20) 5%,transparent 12%),
      linear-gradient(180deg,rgba(4,6,7,.34) 0%,rgba(4,6,7,.08) 6%,transparent 15%),
      linear-gradient(0deg,rgba(4,6,7,.82) 0%,rgba(4,6,7,.32) 8%,transparent 21%)!important;
  }
  .heroVisual:after{
    content:''!important;
    position:absolute!important;
    inset:0!important;
    z-index:3!important;
    pointer-events:none!important;
    background:
      radial-gradient(circle at 69% 29%,rgba(255,174,66,.12),transparent 26%),
      radial-gradient(circle at 95% 58%,rgba(255,107,10,.07),transparent 28%)!important;
    mix-blend-mode:screen!important;
  }
  .heroGlow{display:none!important}
  .ey{font-size:11px!important;letter-spacing:.42em!important;margin-bottom:16px!important;color:#f7a006!important}
  .hero h1{font-size:76px!important;line-height:.86!important;letter-spacing:-.004em!important;text-shadow:0 6px 28px rgba(0,0,0,.28)!important}
  .heroLead{max-width:540px!important;margin-top:17px!important;font-size:15px!important;line-height:1.48!important}
  .heroActions{grid-template-columns:230px 224px 288px!important;gap:14px!important;margin-top:25px!important}
  .heroBtn{height:57px!important}

  /* A faixa inferior funde o banner no restante do site sem corte duro. */
  .infoStrip{
    position:relative!important;
    padding:0 0 17px!important;
    background:
      linear-gradient(180deg,rgba(4,6,7,.90) 0%,rgba(4,6,7,.98) 100%)!important;
  }
  .infoStrip:before{
    content:'';
    position:absolute;
    left:0;right:0;top:-46px;height:46px;
    pointer-events:none;
    background:linear-gradient(180deg,transparent,rgba(4,6,7,.92));
  }
  .infoGrid{grid-template-columns:1.05fr 1.05fr .93fr 1.05fr!important;gap:15px!important}
  .infoCard{height:90px!important;padding:15px 17px!important;background:linear-gradient(145deg,rgba(12,17,19,.985),rgba(6,10,12,.985))!important;border-color:#293238!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.018),0 16px 36px rgba(0,0,0,.15)!important}

  .portal{
    position:relative!important;
    padding:0 0 23px!important;
    background:
      radial-gradient(560px 280px at 0% 52%,rgba(167,71,15,.075),transparent 72%),
      radial-gradient(600px 300px at 100% 51%,rgba(195,78,11,.08),transparent 72%),
      linear-gradient(180deg,rgba(4,6,7,.985),rgba(3,5,6,.995))!important;
  }
  .portalGrid{grid-template-columns:29% 35.4% 35.6%!important;gap:15px!important}
  .feature{height:246px!important;border-color:#293238!important;box-shadow:0 18px 46px rgba(0,0,0,.22),inset 0 1px 0 rgba(255,255,255,.015)!important}

  /* Loja: imagem forte à esquerda, fade suave para o conteúdo. */
  .storeCard{overflow:hidden!important;background:linear-gradient(90deg,#0b0d0d 0%,#080c0e 55%,#070a0c 100%)!important}
  .storeArt{width:56%!important;background-image:url('/api/home/art/store?v=user-banner-final-20260915')!important;background-size:cover!important;background-position:center!important;background-repeat:no-repeat!important;filter:saturate(1.10) contrast(1.055) brightness(1.015)!important}
  .storeArt:after{content:'';position:absolute;inset:0;pointer-events:none;background:linear-gradient(90deg,rgba(5,7,8,.02) 0%,rgba(5,7,8,.03) 28%,rgba(5,7,8,.20) 50%,rgba(8,12,14,.68) 77%,#080c0e 100%),linear-gradient(180deg,rgba(3,5,6,.24),transparent 16%,transparent 78%,rgba(3,5,6,.50))}
  .storeCard:after{content:'';position:absolute;inset:0;z-index:2;pointer-events:none;background:radial-gradient(circle at 17% 82%,rgba(255,132,24,.10),transparent 36%)}
  .crate{display:none!important}
  .storeCopy{left:45%!important;top:38px!important;z-index:4!important}

  /* Discord: nada de linha solta; imagem e texto unidos pelo mesmo fade. */
  .communityCard{padding:27px 31px!important;background-image:linear-gradient(90deg,rgba(5,7,8,.975) 0%,rgba(5,7,8,.88) 39%,rgba(5,7,8,.56) 63%,rgba(5,7,8,.25) 100%),linear-gradient(180deg,rgba(3,5,6,.10),rgba(3,5,6,.36)),url('/api/home/art/community?v=user-banner-final-20260915')!important;background-size:cover!important;background-position:center!important;background-repeat:no-repeat!important}
  .communityCard>*{position:relative!important;z-index:3!important}
  .communityCard:after{content:''!important;position:absolute!important;inset:0!important;z-index:1!important;pointer-events:none!important;background:radial-gradient(circle at 90% 72%,rgba(255,125,15,.11),transparent 42%),linear-gradient(180deg,rgba(4,6,7,.15),transparent 18%,transparent 74%,rgba(4,6,7,.48))!important}
  .communityStats{border-top:0!important;left:22px!important;right:22px!important;bottom:14px!important;padding:11px 13px 0!important;background:linear-gradient(90deg,rgba(4,6,7,.38),rgba(4,6,7,.17),rgba(4,6,7,.03))!important;backdrop-filter:blur(1px)!important}
  .communityStats:before,.communityStats:after,.communityCard hr{display:none!important}

  .footer{height:75px!important;background:linear-gradient(180deg,rgba(4,6,7,.99),#030506)!important;border-top-color:#252d31!important}
}

.heroVisual.reveal{filter:none!important}
.heroVisual.reveal.in{opacity:1!important;filter:none!important}
.heroVisual .heroBanner{pointer-events:none!important}
.heroBanner{animation:none!important;transform:none!important}

@media (min-width:1500px){.hero h1{font-size:78px!important}}
@media (max-width:1300px){
  body{background:linear-gradient(180deg,#050708,#030506)!important}
  .heroBanner{content:url('/api/home/art/hero?v=user-banner-final-20260915')!important;animation:none!important;transform:none!important}
  .communityStats{border-top:0!important}
  .communityCard hr{display:none!important}
}
</style>`;

  return base.replace("</head>", `${css}</head>`);
}

import type { Request } from "express";
import { renderHome as renderBaseHome } from "./homePage.js";

// The original artwork is served intact; all blending happens in CSS.
const heroUrl = "/api/home/art/hero?v=hd-20260915";

export function renderHome(req: Request): string {
  const base = renderBaseHome(req)
    .replace('src="/api/home/banner"', `src="${heroUrl}" width="1983" height="793" fetchpriority="high" decoding="async"`)
    .replace('class="heroVisual reveal" data-tilt="soft"', 'class="heroVisual" aria-hidden="true"')
    .replace('ENTRE NA COMUNIDADE</h2>', 'ENTRE NA <em>COMUNIDADE</em></h2>')
    .replace('<a href="/loja"><span>◇</span><b>Loja VIP</b><em>→</em></a>', '<a href="/api/perfil"><span>◎</span><b>Meu Perfil</b><em>→</em></a><a href="/loja"><span>◇</span><b>Loja VIP</b><em>→</em></a>');

  const css = `<link rel="preload" as="image" href="${heroUrl}">
<style id="gf-home-hd-blend">
:root{--page:1594px;--bg:#050708;--orange:#ffad00}
html,body{background:var(--bg)}
body{background:radial-gradient(ellipse at 0% 65%,#a447091a,transparent 36%),radial-gradient(ellipse at 100% 66%,#b4510a1c,transparent 35%),var(--bg)}
.wrap{width:min(var(--page),87.4%)}
.top{height:66px;background:#050708ed}
.brand i{background:linear-gradient(135deg,#ffc52c,#ffa600);box-shadow:inset 0 0 0 1px #ffd66c44}
.hero{position:relative;isolation:isolate;overflow:visible;background:transparent}
.heroGrid{height:clamp(435px,26vw,500px);display:block;overflow:visible}
.heroVisual{position:absolute;inset:0 0 auto;z-index:-1;width:100%;height:calc(100% + 116px);margin:0;overflow:hidden;background:transparent;pointer-events:none;
  -webkit-mask-image:linear-gradient(to bottom,#000 0%,#000 59%,#000d 72%,#0006 87%,transparent 100%);
  mask-image:linear-gradient(to bottom,#000 0%,#000 59%,#000d 72%,#0006 87%,transparent 100%)}
.heroBanner{inset:0;width:100%;height:100%;object-fit:cover;object-position:center 46%;filter:none;transform:none;animation:none;will-change:auto}
.heroVisual:before{inset:0;z-index:2;background:linear-gradient(90deg,#050708ed 0%,#050708c9 17%,#05070891 29%,#0507084d 42%,transparent 61%),linear-gradient(270deg,#050708a6 0%,transparent 14%),linear-gradient(180deg,#05070826 0%,transparent 16%)}
.heroVisual:after{content:none}
.heroGlow{display:none}
.heroCopy{height:100%;width:51%;padding:36px 0 62px;background:transparent;justify-content:center}
.ey{font-size:11px;margin-bottom:17px;color:#ffb600}
.hero h1{font-size:clamp(65px,4.65vw,89px);line-height:.91;letter-spacing:-.018em;text-shadow:0 3px 20px #0005}
.hero h1 em{color:#ffb000;font-size:1.1em}
.heroLead{max-width:550px;color:#b6bdc1;font-size:14px;line-height:1.6;margin-top:20px;text-shadow:0 2px 8px #000}
.heroActions{grid-template-columns:218px 206px 266px;gap:13px;margin-top:26px}
.heroBtn{height:54px;background:#080d10df;font-size:10px;letter-spacing:.035em;padding:0 13px}
.heroBtn.primary{background:linear-gradient(120deg,#ffba08,#ffa800);border-color:#ffc326;box-shadow:0 5px 22px #ff990015}
.heroBtn.primary .btnIcon{background:#ef9b02;border-color:#d48c06}
.infoStrip{position:relative;z-index:2;padding:0 0 18px;background:transparent}
.infoGrid{grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}
.infoCard{height:82px;padding:12px 14px;grid-template-columns:50px minmax(0,1fr) auto;gap:15px;background:linear-gradient(135deg,#0b1114ef,#060b0eee);border-color:#293238}
.infoIcon{width:49px;height:49px;font-size:22px;border-radius:4px}
.infoCard:first-child .infoIcon{color:#00e69b}
.infoCard strong{font-size:14px;letter-spacing:0}
.infoCard small{font-size:8px;letter-spacing:.025em;line-height:1.5}
.infoValue b{font-size:20px;white-space:nowrap}
.seasonBadge{padding:3px 5px;font-size:6px;margin-left:6px;white-space:nowrap}
.portal{position:relative;z-index:2;padding:0 0 16px;background:transparent}
.portalGrid{width:min(1650px,90.8%);grid-template-columns:minmax(0,1fr) minmax(0,1.07fr) minmax(0,1.13fr);gap:16px}
.feature{height:250px;min-width:0;border-color:#293238}
.storeCard{background:#080c0e}
.storeArt{width:64%;background:url('/api/home/art/store?v=hd-20260915') center / cover no-repeat}
.storeArt:after{content:'';position:absolute;inset:0;background:linear-gradient(90deg,transparent 20%,#080c0e33 50%,#080c0e 100%)}
.crate{display:none}
.storeCopy{left:47%;right:22px;top:38px;z-index:2}
.featureTitle{font-size:31px;line-height:1.05;letter-spacing:-.02em}
.featureText{font-size:12px;line-height:1.55;color:#b6bdc1;margin:12px 0 20px}
.outlineBtn{font-size:10px;letter-spacing:.025em}
.leaderHead{height:49px;padding:0 16px}
.leaderHead strong{font-size:11px;letter-spacing:0}
.leaderHead a{white-space:nowrap}
.leaderRow{height:34px;font-size:11px}
.leaderLabel,.leaderRow{grid-template-columns:32px minmax(0,1fr) 66px 56px;padding-left:16px;padding-right:16px}
.communityCard{padding:25px 22px;background:linear-gradient(90deg,#050708ee,#050708b8 52%,#05070842),url('${heroUrl}') center / cover no-repeat}
.communityCard:after{inset:0;width:auto;height:auto;background:linear-gradient(0deg,#05070899,transparent 40%);z-index:0}
.communityTop,.communityCard>.featureText,.discordBtn{position:relative;z-index:1}
.communityTop{gap:12px}
.communityTop .featureTitle{font-size:clamp(24px,1.72vw,33px)}
.discordMark{flex:0 0 40px;height:40px}
.communityCard .featureText{margin:10px 0 16px}
.discordBtn{width:min(100%,280px);height:43px;margin-top:0;background:linear-gradient(120deg,#111931,#0a1020)}
.communityStats{position:absolute;left:22px;right:22px;bottom:20px;grid-template-columns:1fr 1.15fr 1.25fr;gap:12px;border:0;padding:0}
.communityStat{min-width:0}
.communityStat+.communityStat{padding-left:12px;border-left:1px solid #ffffff18}
.communityStat strong{font-size:10px}
.communityStat span{font-size:7px;line-height:1.6}
.footer{height:82px;background:#050708bb}
.heroCopy.reveal{opacity:1;transform:none;filter:none}
a:focus-visible,button:focus-visible{outline:2px solid #ffb000;outline-offset:4px}
@media(min-width:1900px){.heroCopy{padding-bottom:78px}.heroLead{font-size:15px}.heroActions{grid-template-columns:230px 224px 288px}}
@media(max-width:1300px){
  .wrap{width:calc(100% - 48px)}.heroCopy{width:65%}.heroGrid{height:480px}.hero h1{font-size:70px}
  .heroActions{grid-template-columns:200px 194px 248px}.heroActions .heroBtn:last-child{grid-column:auto}
  .infoGrid{grid-template-columns:repeat(2,minmax(0,1fr))}.infoCard{height:82px}
  .portalGrid{grid-template-columns:minmax(0,1fr) minmax(0,1.12fr)}.communityCard{grid-column:1/-1;height:250px}
  .communityTop .featureTitle{font-size:31px}.communityCard .featureText{max-width:470px}.communityStats{max-width:580px}
}
@media(max-width:820px){
  .wrap{width:calc(100% - 32px)}.top{height:62px}.nav{gap:8px}.menu a{padding:0 8px}
  .heroGrid{height:auto;min-height:570px}.heroCopy{width:100%;padding:55px 0 42px;min-height:570px}
  .heroVisual{height:calc(100% + 70px)}.heroBanner{object-position:68% center}
  .heroVisual:before{background:linear-gradient(90deg,#050708d9,#05070880 55%,#05070833),linear-gradient(0deg,#050708 0%,#05070899 25%,transparent 80%)}
  .hero h1{font-size:clamp(47px,9.5vw,70px)}.heroLead{max-width:490px;font-size:13px}
  .heroActions{grid-template-columns:1fr;width:min(100%,460px);gap:10px;margin-top:24px}.heroActions .heroBtn:last-child{grid-column:auto}
  .heroBtn{height:51px}.ey{font-size:9px}.infoGrid{gap:10px}
  .infoCard{grid-template-columns:40px minmax(0,1fr) auto;gap:10px;padding:10px}.infoIcon{width:39px;height:42px}
  .infoCard strong{font-size:12px}.seasonBadge{display:table;margin:4px 0 0}.infoValue b{font-size:17px}
  .portalGrid{grid-template-columns:minmax(0,1fr)}.feature,.communityCard{height:260px;grid-column:auto}
  .storeCopy{left:46%;right:20px}.communityTop .featureTitle{font-size:30px}.communityStats{bottom:20px}
  .footer{height:auto;padding:28px 0}.footerRow{display:grid;justify-content:center;text-align:center;gap:18px}
}
@media(max-width:520px){
  .brand i{width:32px;height:32px}.menu a{font-size:7px;padding:0 6px;letter-spacing:.07em}.account{font-size:8px;gap:5px}.accountAvatar{width:25px;height:25px}.account b{max-width:48px}
  .infoGrid{grid-template-columns:1fr}.infoCard{height:80px;padding:12px 15px;grid-template-columns:48px minmax(0,1fr) auto;gap:14px}.infoIcon{width:46px;height:46px}.infoCard strong{font-size:14px}.seasonBadge{display:inline-flex;margin-left:6px}
  .storeCopy{left:43%;right:16px}.featureTitle{font-size:28px}.featureText{font-size:11px}.outlineBtn{gap:12px;font-size:9px}
  .communityCard{padding:22px 18px;height:280px}.communityTop{gap:9px}.communityTop .featureTitle{font-size:26px}.discordMark{flex-basis:33px;height:35px}.communityStats{left:18px;right:18px;gap:8px}.communityStat+.communityStat{padding-left:8px}.communityStat strong{font-size:9px}.communityStat span{font-size:6.5px}
  .leaderHead{padding:0 12px}.leaderHead strong{font-size:10px}.leaderHead a{font-size:8px}.leaderLabel,.leaderRow{grid-template-columns:24px minmax(0,1fr) 44px 42px;padding-left:12px;padding-right:12px}
}
</style>`;
  return base.replace("</head>", `${css}</head>`);
}

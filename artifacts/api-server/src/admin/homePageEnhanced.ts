import type { Request } from "express";
import { renderHome as renderBaseHome } from "./homePage.js";
import { brandThemeCss } from "./brandTheme.js";
import { getCommunitySession } from "./communitySession.js";

const heroRawUrl = "https://raw.githubusercontent.com/kaiquedupix-max/Guerrafira-railway/main/artifacts/api-server/public/banner-guerra-fria-infinito.gif";

export function renderHome(req: Request): string {
  const session = getCommunitySession(req);
  const storeHref = session ? "/loja" : "/api/admin/auth/login?target=store";
  const storeCta = `<a class="storeCta" href="${storeHref}"><span class="storeGlow"></span><span class="storeIcon">🛒</span><span class="storeCopy"><small>LOJINHA OFICIAL</small><b>Compre seu VIP aqui</b><em>PIX ou cartão • entrega automática no Rust + cargo no Discord</em></span><span class="storeArrow">→</span></a>`;

  return renderBaseHome(req)
    .replace("</head>", `${brandThemeCss}</head>`)
    .replace("</style>", `.homeMedia{position:relative;margin:0 auto 34px;border:1px solid #72502b;border-radius:24px;overflow:hidden;background:#0a070c;box-shadow:0 28px 80px #0009;aspect-ratio:16/9}.homeMedia img{display:block;width:100%;height:100%;object-fit:cover}.homeMedia:after{content:'';position:absolute;inset:0;box-shadow:inset 0 0 60px #0008;pointer-events:none}.storeCta{position:relative;overflow:hidden;max-width:850px;margin:30px auto 34px;display:flex;align-items:center;gap:17px;text-decoration:none;color:#fff;padding:20px 22px;border-radius:22px;border:1px solid #9b6a2d;background:linear-gradient(120deg,#271709 0%,#17100f 42%,#17101f 72%,#251431 100%);box-shadow:0 22px 60px #0008,inset 0 1px #fff1;transition:transform .2s,border-color .2s,box-shadow .2s;isolation:isolate}.storeCta:hover{transform:translateY(-3px);border-color:#e0a748;box-shadow:0 28px 72px #0009,0 0 34px #c98a2930}.storeGlow{position:absolute;width:230px;height:230px;border-radius:50%;right:-80px;top:-100px;background:radial-gradient(circle,#8b5cf655 0%,#8b5cf610 45%,transparent 70%);z-index:-1}.storeIcon{width:60px;height:60px;flex:0 0 60px;border-radius:18px;display:grid;place-items:center;font-size:29px;background:linear-gradient(145deg,#402910,#201309);border:1px solid #a16e2b;box-shadow:inset 0 1px #fff2,0 8px 24px #0006}.storeCopy{display:flex;flex-direction:column;min-width:0}.storeCopy small{font-size:10px;letter-spacing:.2em;color:#efbd65;font-weight:950}.storeCopy b{font-size:24px;letter-spacing:-.02em;margin:4px 0 3px}.storeCopy em{font-size:12px;color:#b5a9be;font-style:normal;line-height:1.45}.storeArrow{margin-left:auto;color:#ffd84d;font-size:28px;font-weight:950;transition:transform .2s}.storeCta:hover .storeArrow{transform:translateX(4px)}@media(max-width:700px){.homeMedia{margin-bottom:28px;border-radius:18px}.nav{margin-bottom:36px!important}.storeCta{margin:26px 0 28px;padding:17px;border-radius:19px;gap:13px}.storeIcon{width:50px;height:50px;flex-basis:50px;font-size:24px}.storeCopy small{font-size:8px}.storeCopy b{font-size:19px}.storeCopy em{font-size:10px;max-width:240px}.storeArrow{font-size:22px}}</style>`)
    .replace("</nav>", `</nav><div class="homeMedia"><img src="${heroRawUrl}" alt="Guerra Fria 2X"></div>`)
    .replace('</section><section class="choices">', `</section>${storeCta}<section class="choices">`);
}

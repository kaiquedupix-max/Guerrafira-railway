import type { Request } from "express";
import { renderHome as renderBaseHome } from "./homePage.js";
import { brandThemeCss } from "./brandTheme.js";
import { getCommunitySession } from "./communitySession.js";

const heroRawUrl = "https://raw.githubusercontent.com/kaiquedupix-max/Guerrafira-railway/main/artifacts/api-server/public/banner-guerra-fria-infinito.gif";

export function renderHome(req: Request): string {
  const session = getCommunitySession(req);
  const storeHref = session ? "/loja" : "/api/admin/auth/login?target=store";
  const storeCta = `<a class="storeCta" href="${storeHref}"><span class="storeIcon">🛒</span><span class="storeCopy"><small>LOJINHA DO SERVIDOR</small><b>Compre seu VIP aqui</b><em>PIX ou cartão • ativação automática no Rust e Discord</em></span><span class="storeArrow">→</span></a>`;

  return renderBaseHome(req)
    .replace("</head>", `${brandThemeCss}</head>`)
    .replace("</style>", `.homeMedia{position:relative;margin:0 auto 22px;border:1px solid #72502b;border-radius:24px;overflow:hidden;background:#0a070c;box-shadow:0 28px 80px #0009;aspect-ratio:16/9}.homeMedia img{display:block;width:100%;height:100%;object-fit:cover}.homeMedia:after{content:'';position:absolute;inset:0;box-shadow:inset 0 0 60px #0008;pointer-events:none}.storeCta{max-width:850px;margin:0 auto 38px;display:flex;align-items:center;gap:16px;text-decoration:none;color:#fff;padding:18px 20px;border-radius:20px;border:1px solid #8d6531;background:linear-gradient(135deg,#24170b,#17101f 55%,#21152f);box-shadow:0 20px 55px #0007,inset 0 0 30px #ffd84d0a;transition:.2s}.storeCta:hover{transform:translateY(-2px);border-color:#d29a45}.storeIcon{width:54px;height:54px;flex:0 0 54px;border-radius:16px;display:grid;place-items:center;font-size:27px;background:linear-gradient(145deg,#3b270e,#21150a);border:1px solid #8f6428}.storeCopy{display:flex;flex-direction:column;min-width:0}.storeCopy small{font-size:9px;letter-spacing:.18em;color:#e7b85f;font-weight:900}.storeCopy b{font-size:22px;margin:3px 0}.storeCopy em{font-size:11px;color:#a99db5;font-style:normal}.storeArrow{margin-left:auto;color:#ffd84d;font-size:24px;font-weight:900}@media(max-width:700px){.homeMedia{margin-bottom:16px;border-radius:18px}.nav{margin-bottom:36px!important}.storeCta{margin-bottom:28px;padding:15px 16px;border-radius:17px;gap:12px}.storeIcon{width:46px;height:46px;flex-basis:46px;font-size:23px}.storeCopy b{font-size:18px}.storeCopy em{font-size:10px}.storeArrow{font-size:20px}}</style>`)
    .replace("</nav>", `</nav><div class="homeMedia"><img src="${heroRawUrl}" alt="Guerra Fria 2X"></div>${storeCta}`);
}

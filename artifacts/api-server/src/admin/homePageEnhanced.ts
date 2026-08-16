import type { Request } from "express";
import { renderHome as renderBaseHome } from "./homePage.js";

const heroRawUrl = "https://raw.githubusercontent.com/kaiquedupix-max/Guerrafira-railway/main/artifacts/api-server/public/guerra-fria-hero.jpeg";

export function renderHome(req: Request): string {
  return renderBaseHome(req)
    .replace("</style>", `.homeMedia{position:relative;margin:0 auto 38px;border:1px solid #72502b;border-radius:24px;overflow:hidden;background:#0a070c;box-shadow:0 28px 80px #0009;aspect-ratio:16/9}.homeMedia img{display:block;width:100%;height:100%;object-fit:cover}.homeMedia:after{content:'';position:absolute;inset:0;box-shadow:inset 0 0 60px #0008;pointer-events:none}@media(max-width:700px){.homeMedia{margin-bottom:30px;border-radius:18px}.nav{margin-bottom:36px!important}}</style>`)
    .replace("</nav>", `</nav><div class="homeMedia"><img src="${heroRawUrl}" alt="Guerra Fria 2X"></div>`);
}

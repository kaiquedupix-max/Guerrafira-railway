import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import webhookRouter from "./routes/webhook.js";
import { leaderboardHtml } from "./routes/leaderboardV2";
import { renderSeasonPage } from "./routes/seasonPage.js";
import { renderSeasonGuide } from "./routes/seasonGuide.js";
import { renderAdmin } from "./admin/appRenderShim.js";
import { renderCommunityPage } from "./admin/communityPage.js";
import { renderHome } from "./admin/homePageEnhanced.js";
import { renderStorePage } from "./admin/storePage.js";
import { withSiteChrome } from "./admin/siteChrome.js";
import { getCommunitySession } from "./admin/communitySession.js";
import { getAdminSessionV3, issueAdminSessionV3 } from "./admin/sessionBearer.js";
import { logger } from "./lib/logger";
import { startStoragePolicy } from "./storagePolicy.js";

if (process.env.PTERODACTYL_URL) process.env.ELGAE_PANEL_URL = process.env.PTERODACTYL_URL;
if (process.env.PTERODACTYL_SERVER_ID) process.env.ELGAE_SERVER_ID = process.env.PTERODACTYL_SERVER_ID;
if (process.env.PTERODACTYL_API_KEY) process.env.ELGAE_API_KEY = process.env.PTERODACTYL_API_KEY;

const SEASON_1_START_AT = Date.parse("2026-09-03T00:00:00-03:00");

function isSeasonAdmin(req: express.Request): boolean {
  return Boolean(getCommunitySession(req)?.isAdmin || getAdminSessionV3(req));
}

function isSeasonPublic(seasonNumber: number): boolean {
  return seasonNumber !== 1 || Date.now() >= SEASON_1_START_AT;
}

function renderSeasonComingSoon(): string {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#08060d"><title>Em breve • Guerra Fria</title><style>*{box-sizing:border-box}html,body{margin:0;min-height:100%;background:#08060d;color:#fff;font-family:Inter,system-ui,-apple-system,sans-serif}body{min-height:100vh;display:grid;place-items:center;background:radial-gradient(circle at 50% 30%,#28163a 0,#120b19 34%,#08060d 72%)}h1{margin:0;font-size:clamp(42px,12vw,92px);letter-spacing:-.055em;font-weight:1000;text-align:center}</style></head><body><h1>Em breve</h1></body></html>`;
}

const app: Express = express();
startStoragePolicy();
app.use(pinoHttp({logger,serializers:{req(req){return{id:req.id,method:req.method,url:req.url?.split("?")[0]};},res(res){return{statusCode:res.statusCode};}}}));
app.use(cors()); app.use(cookieParser()); app.use(express.json({limit:"18mb"})); app.use(express.urlencoded({extended:true}));
app.use((req,res,next)=>{if(req.path.startsWith("/admin")||req.path.startsWith("/painel")||req.path.startsWith("/api/admin")){res.setHeader("Cache-Control","no-store, no-cache, must-revalidate, proxy-revalidate");res.setHeader("Pragma","no-cache");res.setHeader("Expires","0");}next();});
app.get("/",(req,res)=>res.status(200).type("html").send(renderHome(req)));
app.get("/leaderboard",(req,res)=>{const session=getCommunitySession(req);return res.status(200).type("html").send(session?withSiteChrome(leaderboardHtml,"leaderboard",{isAdmin:session.isAdmin,username:session.username}):leaderboardHtml);});

// Guia/FAQ permanece público antes da abertura da Season 1.
app.get("/season:seasonNumber/guia",(req,res)=>{const n=Math.max(1,Math.trunc(Number(req.params.seasonNumber)||1));const community=getCommunitySession(req);const admin=getAdminSessionV3(req);let html=renderSeasonGuide(n);html=html.replace("</style>",`.top{top:68px}.hero{padding-top:64px}.hero:after{content:'SEASON 1 • INÍCIO 03/09/2026';display:inline-flex;margin-top:18px;padding:8px 12px;border-radius:999px;border:1px solid #6b4587;background:#1c1027;color:#e2c9ff;font-size:10px;font-weight:950;letter-spacing:.12em}.section{box-shadow:0 18px 50px #0004}.q,.box,.drawing{transition:transform .18s,border-color .18s}.q:hover,.box:hover,.drawing:hover{transform:translateY(-2px);border-color:#6b4587}@media(max-width:760px){.top{top:0}.hero{padding-top:38px}}</style>`);html=withSiteChrome(html,"season",{isAdmin:Boolean(community?.isAdmin||admin),username:community?.username||admin?.username||""});res.setHeader("Cache-Control","no-store, no-cache, must-revalidate, proxy-revalidate");return res.status(200).type("html").send(html);});

app.get("/season:seasonNumber",(req,res)=>{const n=Math.max(1,Math.trunc(Number(req.params.seasonNumber)||1));res.setHeader("Cache-Control","no-store, no-cache, must-revalidate, proxy-revalidate");if(!isSeasonPublic(n)&&!isSeasonAdmin(req))return res.status(200).type("html").send(renderSeasonComingSoon());let html=renderSeasonPage(n);const guide=`<section style="margin:22px 0;border:1px solid #7046a0;background:linear-gradient(135deg,#21122f,#0d0f13);border-radius:18px;padding:20px;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;box-shadow:0 20px 60px #0005"><div><div style="font-size:11px;font-weight:950;letter-spacing:.15em;color:#d9bfff">📖 GUIA OFICIAL + FAQ</div><div style="font-size:22px;font-weight:950;margin-top:5px">Como funciona o MMR?</div><div style="font-size:12px;color:#b5bac3;max-width:680px;line-height:1.55;margin-top:5px">Armas, headshot, distância, pelados, mortes, farm, raid, construção, eventos, bots, animais e anti-farm explicados passo a passo — com exemplos visuais.</div></div><a href="/season${n}/guia" style="text-decoration:none;background:linear-gradient(135deg,#7c3aed,#5b21b6);border:1px solid #a78bfa;color:white;padding:12px 16px;border-radius:11px;font-size:12px;font-weight:950">ABRIR GUIA →</a></section>`;html=html.replace("</main>",guide+"</main>");const community=getCommunitySession(req);const admin=getAdminSessionV3(req);html=withSiteChrome(html,"season",{isAdmin:Boolean(community?.isAdmin||admin),username:community?.username||admin?.username||""});return res.status(200).type("html").send(html);});

app.get("/loja",(req,res)=>{const session=getCommunitySession(req);if(!session)return res.redirect("/api/admin/auth/login?target=store");return res.status(200).type("html").send(withSiteChrome(renderStorePage(session.username),"home",{isAdmin:session.isAdmin,username:session.username}));});
const renderIntegrity=(req:express.Request,res:express.Response)=>{const session=getCommunitySession(req);const html=renderCommunityPage(req);return res.status(200).type("html").send(session?withSiteChrome(html,"integrity",{isAdmin:session.isAdmin,username:session.username}):html);};
app.get("/integridade",renderIntegrity);app.get("/auditoria",renderIntegrity);app.get("/comunidade",(req,res)=>res.redirect(301,"/integridade"));
const renderAdminPanel=(req:express.Request,res:express.Response)=>{let admin=getAdminSessionV3(req);if(!admin){const community=getCommunitySession(req);if(community?.isAdmin){issueAdminSessionV3(res,community.userId,community.username);return res.redirect("/painel");}return res.redirect("/api/admin/auth/login?target=admin");}return res.status(200).type("html").send(withSiteChrome(renderAdmin(req),"admin",{isAdmin:true,username:admin.username}));};
app.get("/painel",renderAdminPanel);app.get("/admin",(req,res)=>res.redirect(302,"/painel"));
app.get("/status",(_req,res)=>res.status(200).json({status:"ok",service:"guerra-fria"}));app.use("/api",router);app.use("/webhook",webhookRouter);
export default app;
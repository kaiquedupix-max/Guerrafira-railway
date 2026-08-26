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

const app: Express = express();
startStoragePolicy();
app.use(pinoHttp({logger,serializers:{req(req){return{id:req.id,method:req.method,url:req.url?.split("?")[0]};},res(res){return{statusCode:res.statusCode};}}}));
app.use(cors()); app.use(cookieParser()); app.use(express.json({limit:"18mb"})); app.use(express.urlencoded({extended:true}));
app.use((req,res,next)=>{if(req.path.startsWith("/admin")||req.path.startsWith("/painel")||req.path.startsWith("/api/admin")){res.setHeader("Cache-Control","no-store, no-cache, must-revalidate, proxy-revalidate");res.setHeader("Pragma","no-cache");res.setHeader("Expires","0");}next();});
app.get("/",(req,res)=>res.status(200).type("html").send(renderHome(req)));
app.get("/leaderboard",(req,res)=>{const session=getCommunitySession(req);return res.status(200).type("html").send(session?withSiteChrome(leaderboardHtml,"leaderboard",{isAdmin:session.isAdmin,username:session.username}):leaderboardHtml);});

// Guia/FAQ público. Deve vir ANTES de /season:seasonNumber para não ser capturado como season inválida.
app.get("/season:seasonNumber/guia",(req,res)=>{const n=Math.max(1,Math.trunc(Number(req.params.seasonNumber)||1));res.setHeader("Cache-Control","no-store, no-cache, must-revalidate, proxy-revalidate");return res.status(200).type("html").send(renderSeasonGuide(n));});

app.get("/season:seasonNumber",(req,res)=>{const n=Math.max(1,Math.trunc(Number(req.params.seasonNumber)||1));res.setHeader("Cache-Control","no-store, no-cache, must-revalidate, proxy-revalidate");let html=renderSeasonPage(n);const guide=`<section style="margin:22px 0;border:1px solid #7f1d1d;background:linear-gradient(135deg,#2b1012,#0d0f13);border-radius:18px;padding:20px;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap"><div><div style="font-size:11px;font-weight:950;letter-spacing:.15em;color:#fca5a5">📖 GUIA OFICIAL + FAQ</div><div style="font-size:22px;font-weight:950;margin-top:5px">Como funciona o MMR?</div><div style="font-size:12px;color:#b5bac3;max-width:680px;line-height:1.55;margin-top:5px">Armas, headshot, distância, pelados, mortes, farm, raid, construção, eventos, bots, animais e anti-farm explicados passo a passo — com exemplos visuais.</div></div><a href="/season${n}/guia" style="text-decoration:none;background:#dc2626;color:white;padding:12px 16px;border-radius:11px;font-size:12px;font-weight:950">ABRIR GUIA →</a></section>`;html=html.replace("</main>",guide+"</main>");return res.status(200).type("html").send(html);});

app.get("/loja",(req,res)=>{const session=getCommunitySession(req);if(!session)return res.redirect("/api/admin/auth/login?target=store");return res.status(200).type("html").send(withSiteChrome(renderStorePage(session.username),"home",{isAdmin:session.isAdmin,username:session.username}));});
const renderIntegrity=(req:express.Request,res:express.Response)=>{const session=getCommunitySession(req);const html=renderCommunityPage(req);return res.status(200).type("html").send(session?withSiteChrome(html,"integrity",{isAdmin:session.isAdmin,username:session.username}):html);};
app.get("/integridade",renderIntegrity);app.get("/auditoria",renderIntegrity);app.get("/comunidade",(req,res)=>res.redirect(301,"/integridade"));
const renderAdminPanel=(req:express.Request,res:express.Response)=>{let admin=getAdminSessionV3(req);if(!admin){const community=getCommunitySession(req);if(community?.isAdmin){issueAdminSessionV3(res,community.userId,community.username);return res.redirect("/painel");}return res.redirect("/api/admin/auth/login?target=admin");}return res.status(200).type("html").send(withSiteChrome(renderAdmin(req),"admin",{isAdmin:true,username:admin.username}));};
app.get("/painel",renderAdminPanel);app.get("/admin",(req,res)=>res.redirect(302,"/painel"));
app.get("/status",(_req,res)=>res.status(200).json({status:"ok",service:"guerra-fria"}));app.use("/api",router);app.use("/webhook",webhookRouter);
export default app;

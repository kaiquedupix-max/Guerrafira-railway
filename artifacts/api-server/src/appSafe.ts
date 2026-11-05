import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import webhookRouter from "./routes/webhook.js";
import { leaderboardHtml } from "./routes/leaderboardV2";
import { renderAdmin } from "./admin/appRenderShim.js";
import { renderCommunityPage } from "./admin/communityPage.js";
import { renderHome } from "./admin/homePageEnhanced.js";
import { renderStorePage } from "./admin/storePage.js";
import { renderDonationPage } from "./routes/donations.js";
import { renderBaseInvadersPage } from "./routes/baseInvadersPage.js";
import { withSiteChrome } from "./admin/siteChrome.js";
import { getCommunitySession } from "./admin/communitySession.js";
import { getAdminSessionV3, issueAdminSessionV3 } from "./admin/sessionBearer.js";
import { logger } from "./lib/logger";
import { startStoragePolicy } from "./storagePolicy.js";
import { enhanceHomeHtml } from "./core/multiServerUi.js";

if (process.env.PTERODACTYL_URL) process.env.ELGAE_PANEL_URL = process.env.PTERODACTYL_URL;
if (process.env.PTERODACTYL_SERVER_ID) process.env.ELGAE_SERVER_ID = process.env.PTERODACTYL_SERVER_ID;
if (process.env.PTERODACTYL_API_KEY) process.env.ELGAE_API_KEY = process.env.PTERODACTYL_API_KEY;

const app: Express = express();
startStoragePolicy();
app.use(pinoHttp({logger,serializers:{req(req){return{id:req.id,method:req.method,url:req.url?.split("?")[0]};},res(res){return{statusCode:res.statusCode};}}}));
app.use(cors());
app.use(cookieParser());
const REQUEST_BODY_LIMIT = "32mb";
app.use(express.json({ limit: REQUEST_BODY_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: REQUEST_BODY_LIMIT }));
app.use((req,res,next)=>{
  if(req.path.startsWith("/admin")||req.path.startsWith("/painel")||req.path.startsWith("/api/admin")){
    res.setHeader("Cache-Control","no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma","no-cache");
    res.setHeader("Expires","0");
  }
  next();
});

app.get("/",(req,res)=>{res.setHeader("Cache-Control","no-store, max-age=0, must-revalidate");return res.status(200).type("html").send(enhanceHomeHtml(renderHome(req),req));});
app.get("/leaderboard",(req,res)=>{
  const session=getCommunitySession(req);
  return res.status(200).type("html").send(withSiteChrome(leaderboardHtml,"leaderboard",{isAdmin:Boolean(session?.isAdmin),username:session?.username||""}));
});

app.get("/base-invaders",(req,res)=>{
  const session=getCommunitySession(req);
  res.setHeader("Cache-Control","no-store, max-age=0, must-revalidate");
  return res.status(200).type("html").send(withSiteChrome(renderBaseInvadersPage(session),"base-invaders",{isAdmin:Boolean(session?.isAdmin),username:session?.username||""}));
});
app.get(/^\/season\d*(?:\/guia)?\/?$/i,(_req,res)=>res.redirect(301,"/base-invaders"));

app.get("/doar",(req,res)=>{
  const session=getCommunitySession(req);
  res.setHeader("Cache-Control","no-store, no-cache, must-revalidate, proxy-revalidate");
  const html=renderDonationPage(session?.username||"");
  return res.status(200).type("html").send(withSiteChrome(html,"donation",{isAdmin:Boolean(session?.isAdmin),username:session?.username||""}));
});

app.get("/loja",(req,res)=>{
  const session=getCommunitySession(req);
  if(!session)return res.redirect("/api/admin/auth/login?target=store&server="+(req.query.server === "trio" ? "trio" : "solo-duo"));
  return res.status(200).type("html").send(withSiteChrome(renderStorePage(session.username),"home",{isAdmin:session.isAdmin,username:session.username}));
});

app.get("/promo",(_req,res)=>res.redirect(301,"/base-invaders"));
app.get("/promo/resgatar",(_req,res)=>res.redirect(301,"/base-invaders"));

const renderIntegrity=(req:express.Request,res:express.Response)=>{
  const session=getCommunitySession(req);
  const html=renderCommunityPage(req);
  return res.status(200).type("html").send(withSiteChrome(html,"integrity",{isAdmin:Boolean(session?.isAdmin),username:session?.username||""}));
};
app.get("/integridade",renderIntegrity);
app.get("/auditoria",renderIntegrity);
app.get("/comunidade",(req,res)=>res.redirect(301,"/integridade"));
const renderAdminPanel=(req:express.Request,res:express.Response)=>{
  const admin=getAdminSessionV3(req);
  if(!admin){
    const community=getCommunitySession(req);
    if(community?.isAdmin){issueAdminSessionV3(res,community.userId,community.username);return res.redirect("/painel");}
    return res.redirect("/api/admin/auth/login?target=admin");
  }
  return res.status(200).type("html").send(withSiteChrome(renderAdmin(req),"admin",{isAdmin:true,username:admin.username}));
};
app.get("/painel",renderAdminPanel);
app.get("/admin",(req,res)=>res.redirect(302,"/painel"));
app.get("/status",(_req,res)=>res.status(200).json({status:"ok",service:"guerra-fria"}));
app.use("/api",router);
app.use("/webhook",webhookRouter);
export default app;

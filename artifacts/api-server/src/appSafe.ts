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
import { withSiteChrome } from "./admin/siteChrome.js";
import { getCommunitySession } from "./admin/communitySession.js";
import { getAdminSessionV3, issueAdminSessionV3 } from "./admin/sessionBearer.js";
import { logger } from "./lib/logger";
import { startStoragePolicy } from "./storagePolicy.js";

const app: Express = express();
startStoragePolicy();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);
app.use(cors());
app.use(cookieParser());
app.use(express.json({ limit: "18mb" }));
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  if (req.path.startsWith("/admin") || req.path.startsWith("/painel") || req.path.startsWith("/api/admin")) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
  }
  next();
});

app.get("/", (req, res) => res.status(200).type("html").send(renderHome(req)));
app.get("/leaderboard", (req, res) => {
  const session = getCommunitySession(req);
  if (!session) return res.redirect("/api/admin/auth/login?target=leaderboard");
  return res.status(200).type("html").send(withSiteChrome(leaderboardHtml, "leaderboard", { isAdmin: session.isAdmin, username: session.username }));
});

app.get("/loja", (req, res) => {
  const session = getCommunitySession(req);
  if (!session) return res.redirect("/api/admin/auth/login?target=store");
  return res.status(200).type("html").send(withSiteChrome(renderStorePage(session.username), "home", { isAdmin: session.isAdmin, username: session.username }));
});

const renderIntegrity = (req: express.Request, res: express.Response) => {
  const session = getCommunitySession(req);
  const html = renderCommunityPage(req);
  return res.status(200).type("html").send(session ? withSiteChrome(html, "integrity", { isAdmin: session.isAdmin, username: session.username }) : html);
};
app.get("/integridade", renderIntegrity);
app.get("/comunidade", (req, res) => res.redirect(301, "/integridade"));

const renderAdminPanel = (req: express.Request, res: express.Response) => {
  let admin = getAdminSessionV3(req);

  if (!admin) {
    const community = getCommunitySession(req);
    if (community?.isAdmin) {
      issueAdminSessionV3(res, community.userId, community.username);
      return res.redirect("/painel");
    }
    return res.redirect("/api/admin/auth/login?target=admin");
  }

  return res.status(200).type("html").send(withSiteChrome(renderAdmin(req), "admin", { isAdmin: true, username: admin.username }));
};
app.get("/painel", renderAdminPanel);
app.get("/admin", (req, res) => res.redirect(302, "/painel"));

app.get("/status", (_req, res) => res.status(200).json({ status: "ok", service: "guerra-fria" }));
app.use("/api", router);
app.use("/webhook", webhookRouter);

export default app;

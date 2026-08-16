import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import webhookRouter from "./routes/webhook.js";
import { leaderboardHtml } from "./routes/leaderboardV2";
import { renderAdmin } from "./admin/appRenderShim.js";
import { logger } from "./lib/logger";
import { startStoragePolicy } from "./storagePolicy.js";

const app: Express = express();
startStoragePolicy();

app.use(pinoHttp({ logger, serializers: { req(req) { return { id: req.id, method: req.method, url: req.url?.split("?")[0] }; }, res(res) { return { statusCode: res.statusCode }; } } }));
app.use(cors());
app.use(cookieParser());
app.use(express.json({ limit: "18mb" }));
app.use(express.urlencoded({ extended: true }));

const leaderboardPage = leaderboardHtml.replace("</body>", '<a href="/api/admin/auth/login" style="position:fixed;right:18px;bottom:18px;z-index:9999;text-decoration:none;background:#6d28d9;color:white;border:1px solid #a78bfa;padding:11px 15px;border-radius:11px;font:800 11px system-ui;box-shadow:0 14px 36px #0008">🛡️ Entrar com Discord</a></body>');

app.get("/", (_req, res) => res.status(200).type("html").send(leaderboardPage));
app.get("/leaderboard", (_req, res) => res.status(200).type("html").send(leaderboardPage));
app.get("/admin", (req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  return res.status(200).type("html").send(renderAdmin(req));
});
app.get("/status", (_req, res) => res.status(200).json({ status: "ok", service: "guerra-fria" }));
app.use("/api", router);
app.use("/webhook", webhookRouter);
export default app;

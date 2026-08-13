import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import webhookRouter from "./routes/webhook.js";
import { leaderboardHtml } from "./routes/leaderboardV2";
import { adminHtml } from "./admin/html.js";
import { adminExtraJs } from "./admin/extra.js";
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
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const leaderboardPage = leaderboardHtml.replace(
  "</body>",
  '<a href="/api/admin/auth/login" style="position:fixed;right:18px;bottom:18px;z-index:9999;text-decoration:none;background:#6d28d9;color:white;border:1px solid #a78bfa;padding:11px 15px;border-radius:11px;font:800 11px system-ui;box-shadow:0 14px 36px #0008">🛡️ Entrar com Discord</a></body>',
);
const adminPage = adminHtml.replace("</body>", `<script>${adminExtraJs}</script></body>`);

app.get("/", (_req, res) => res.status(200).type("html").send(leaderboardPage));
app.get("/leaderboard", (_req, res) => res.status(200).type("html").send(leaderboardPage));
app.get("/admin", (_req, res) => res.status(200).type("html").send(adminPage));
app.get("/status", (_req, res) => res.status(200).json({ status: "ok", service: "guerra-fria" }));

app.use("/api", router);
app.use("/webhook", webhookRouter);

export default app;

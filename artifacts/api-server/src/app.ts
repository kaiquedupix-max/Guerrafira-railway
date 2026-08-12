import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import webhookRouter from "./routes/webhook.js";
import { leaderboardHtml } from "./routes/leaderboard";
import { logger } from "./lib/logger";

const app: Express = express();

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
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/", (_req, res) => res.status(200).type("html").send(leaderboardHtml));
app.get("/leaderboard", (_req, res) => res.status(200).type("html").send(leaderboardHtml));
app.get("/status", (_req, res) => res.status(200).json({ status: "ok", service: "guerra-fria" }));

app.use("/api", router);
app.use("/webhook", webhookRouter);

export default app;

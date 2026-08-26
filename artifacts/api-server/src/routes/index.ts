import { Router, type IRouter } from "express";
import healthRouter from "./health";
import leaderboardRouter from "./leaderboardV2";
import adminRouter from "./admin";
import communityRouter from "./community.js";
import pwaRouter from "./pwa.js";
import storeRouter from "./store.js";
import revenueView from "../admin/revenueView.js";
import { startPaymentStatusNotifier } from "../admin/paymentStatusNotifier.js";
import { startCardPaymentReconciler } from "./paymentReconciler.js";
import leaderboardWebhookRouter from "./leaderboardWebhook.js";
import seasonRouter from "./season.js";
import seasonAuditRouter from "./seasonAudit.js";
import { getCommunitySession } from "../admin/communitySession.js";
import { getAdminSessionV3 } from "../admin/sessionBearer.js";

startPaymentStatusNotifier();
startCardPaymentReconciler();

const router: IRouter = Router();
const SEASON_1_START_AT = Date.parse("2026-09-03T00:00:00-03:00");

router.use(healthRouter);
router.use(leaderboardRouter);
router.use(leaderboardWebhookRouter);
router.use((req, res, next) => {
  if (req.method !== "GET" || !/^\/season\/1(?:\/|$)/.test(req.path) || Date.now() >= SEASON_1_START_AT) return next();
  if (getCommunitySession(req)?.isAdmin || getAdminSessionV3(req)) return next();
  return res.status(403).json({ error: "Em breve" });
});
router.use(seasonAuditRouter);
router.use(seasonRouter);
router.use(pwaRouter);
router.use("/store", storeRouter);
router.use("/admin", adminRouter);
router.use("/community", communityRouter);
router.use("/finance", revenueView);
export default router;

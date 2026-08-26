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

startPaymentStatusNotifier();
startCardPaymentReconciler();

const router: IRouter = Router();
router.use(healthRouter);
router.use(leaderboardRouter);
router.use(leaderboardWebhookRouter);
router.use(seasonAuditRouter);
router.use(seasonRouter);
router.use(pwaRouter);
router.use("/store", storeRouter);
router.use("/admin", adminRouter);
router.use("/community", communityRouter);
router.use("/finance", revenueView);
export default router;

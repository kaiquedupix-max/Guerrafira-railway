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
import seasonTransportRouter from "./seasonTransport.js";
import seasonRouter from "./season.js";
import seasonAuditRouter from "./seasonAudit.js";
import seasonSteamSignupRouter from "./seasonSteamSignup.js";
import seasonAdjustedReadRouter from "./seasonAdjustedRead.js";
import seasonBetaIntroRouter from "./seasonBetaIntro.js";
import seasonBetaRouter, { startSeasonBetaController } from "./seasonBeta.js";
import seasonControlRouter from "./seasonControl.js";

startPaymentStatusNotifier();
startCardPaymentReconciler();
startSeasonBetaController();

const router: IRouter = Router();
router.use(healthRouter);
router.use(leaderboardRouter);
router.use(leaderboardWebhookRouter);
router.use(seasonSteamSignupRouter);
router.use(seasonBetaIntroRouter);
// Controle manual vem antes de qualquer endpoint de ingestão.
router.use(seasonControlRouter);
router.use(seasonTransportRouter);
router.use(seasonAuditRouter);
// Leitura pública ajustada vem antes da leitura legada; ingestão continua bruta do plugin.
router.use(seasonAdjustedReadRouter);
router.use(seasonRouter);
// O router Beta fica depois da ingestão para que o horário fixo antigo não impeça o início manual.
router.use(seasonBetaRouter);
router.use(pwaRouter);
router.use("/store", storeRouter);
router.use("/admin", adminRouter);
router.use("/community", communityRouter);
router.use("/finance", revenueView);
export default router;

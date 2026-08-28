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
import seasonBetaRouter, { startSeasonBetaController } from "./seasonBeta.js";

startPaymentStatusNotifier();
startCardPaymentReconciler();
startSeasonBetaController();

const router: IRouter = Router();

router.use(healthRouter);
router.use(leaderboardRouter);
router.use(leaderboardWebhookRouter);

// A camada Beta fica antes da ingestão da Season para bloquear eventos antes
// de 28/08/2026 18:30 e executar o reset coordenado plugin + banco uma única vez.
router.use(seasonBetaRouter);

// Transporte privado da Season: healthcheck, bootstrap RAM e snapshot em lote.
// Registrado antes das rotas públicas para manter a ingestão independente da UI.
router.use(seasonTransportRouter);

// A página e a API pública da Season ficam disponíveis desde já.
// A data de início controla a competição, não a visibilidade do ranking/guia.
router.use(seasonAuditRouter);
router.use(seasonRouter);

router.use(pwaRouter);
router.use("/store", storeRouter);
router.use("/admin", adminRouter);
router.use("/community", communityRouter);
router.use("/finance", revenueView);

export default router;

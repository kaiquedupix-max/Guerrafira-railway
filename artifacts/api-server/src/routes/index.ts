import { Router, type IRouter } from "express";
import healthRouter from "./health";
import leaderboardRouter from "./leaderboardV2";
import publicStatusRouter from "./publicStatus.js";
import profileRouter from "./profile.js";
import homeMetaRouter from "./homeMeta.js";
import adminRouter from "./admin";
import communityRouter from "./community.js";
import pwaRouter from "./pwa.js";
import storeRouter from "./store.js";
import promoParticipantDetailsRouter from "./promoParticipantDetails.js";
import promoRouter, { startPromoReconciler } from "./promo.js";
import revenueView from "../admin/revenueView.js";
import { withSiteChrome } from "../admin/siteChrome.js";
import { getCommunitySession } from "../admin/communitySession.js";
import { startPaymentStatusNotifier } from "../admin/paymentStatusNotifier.js";
import { startCardPaymentReconciler } from "./paymentReconciler.js";
import { startStripePaymentReconciler } from "./stripePayment.js";
import { startSeasonPaymentReconciler } from "./seasonPaymentReconciler.js";
import leaderboardWebhookRouter from "./leaderboardWebhook.js";
import seasonTransportRouter from "./seasonTransport.js";
import seasonRouter from "./season.js";
import seasonIngestionSafeRouter from "./seasonIngestionSafe.js";
import seasonAuthoritativeGuardRouter from "./seasonAuthoritativeGuard.js";
import seasonAuditRouter from "./seasonAudit.js";
import seasonSteamRegistrationRepairRouter from "./seasonSteamRegistrationRepair.js";
import seasonSteamSignupRouter from "./seasonSteamSignup.js";
import seasonAdjustedReadRouter from "./seasonAdjustedRead.js";
import seasonControlRouter from "./seasonControl.js";
import seasonOfficialRegistrationRouter from "./seasonOfficialRegistration.js";
import seasonOfficialEntryGateRouter from "./seasonOfficialEntryGate.js";
import seasonProductionRegistrationRouter from "./seasonProductionRegistration.js";
import { seasonProfileRankDisplayFix } from "./seasonProfileRankDisplayFix.js";
import seasonEmergencyEmailRepairRouter from "./seasonEmergencyEmailRepair.js";
import seasonEmergencyEmailRepairExecuteRouter from "./seasonEmergencyEmailRepairExecute.js";
import { runSeasonEmailRepairAutorun } from "./seasonEmailRepairAutorun.js";
import rankAssetsRouter from "./rankAssets.js";
import { startSeasonEmailLifecycle } from "./seasonEmailLifecycle.js";
import { startSeasonGameRankSync } from "../bot/seasonGameRankSync.js";
import { repairWipeSchedule20260904 } from "../core/repairWipeSchedule20260904.js";
import vorkenIntegrationRouter from "./vorkenIntegration.js";

startPaymentStatusNotifier();
startCardPaymentReconciler();
startStripePaymentReconciler();
startSeasonPaymentReconciler();
startSeasonEmailLifecycle();
startSeasonGameRankSync();
startPromoReconciler();
void repairWipeSchedule20260904().catch(error => console.error("Failed to repair 04/09 wipe schedule", error));
void runSeasonEmailRepairAutorun();

const router: IRouter = Router();
router.use(healthRouter);
router.use(vorkenIntegrationRouter);

// A página de status é legada e gera o próprio HTML. Interceptamos somente
// GET /status para aplicar o mesmo chrome/tema usado no restante do portal.
router.use((req, res, next) => {
  if (req.method !== "GET" || req.path !== "/status") return next();
  const originalSend = res.send.bind(res);
  res.send = ((body?: any) => {
    if (typeof body === "string" && /<html/i.test(body)) {
      const session = getCommunitySession(req);
      body = withSiteChrome(body, "status", { isAdmin:Boolean(session?.isAdmin), username:session?.username || "" });
    }
    return originalSend(body);
  }) as any;
  next();
});

router.use(publicStatusRouter);
router.use(profileRouter);
router.use(homeMetaRouter);
router.use(rankAssetsRouter);
router.use(leaderboardRouter);
router.use(leaderboardWebhookRouter);
router.use(seasonEmergencyEmailRepairRouter);
router.use(seasonEmergencyEmailRepairExecuteRouter);
router.use(seasonSteamRegistrationRepairRouter);
router.use(seasonOfficialEntryGateRouter);
router.use(seasonSteamSignupRouter);
router.use(seasonProfileRankDisplayFix);
router.use(seasonProductionRegistrationRouter);
router.use(seasonOfficialRegistrationRouter);
router.use(seasonControlRouter);
router.use(seasonAuthoritativeGuardRouter);
router.use(seasonIngestionSafeRouter);
router.use(seasonTransportRouter);
router.use(seasonAuditRouter);
router.use(seasonAdjustedReadRouter);
router.use(seasonRouter);
router.use(pwaRouter);
router.use("/store", storeRouter);
router.use("/promo", promoParticipantDetailsRouter);
router.use("/promo", promoRouter);
router.use("/admin", adminRouter);
router.use("/community", communityRouter);
router.use("/finance", revenueView);
export default router;

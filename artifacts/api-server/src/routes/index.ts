import { Router, type IRouter } from "express";
import healthRouter from "./health";
import leaderboardRouter from "./leaderboardV2";
import publicStatusRouter from "./publicStatus.js";
import statusMultiServerRouter from "./statusMultiServer.js";
import profileRouter from "./profile.js";
import homeMetaRouter from "./homeMeta.js";
import adminRouter from "./admin";
import communityRouter from "./community.js";
import pwaRouter from "./pwa.js";
import storeRouter from "./store.js";
import { startDuoReconciler } from "./duoService.js";
import { startStoreReceipts } from "./storeReceipts.js";
import { startGiftReconciler } from "./giftService.js";
import promoParticipantDetailsRouter from "./promoParticipantDetails.js";
import promoRouter, { startPromoReconciler } from "./promo.js";
import revenueView from "../admin/revenueView.js";
import { withSiteChrome } from "../admin/siteChrome.js";
import { getCommunitySession } from "../admin/communitySession.js";
import { startPaymentStatusNotifier } from "../admin/paymentStatusNotifier.js";
import { startCardPaymentReconciler } from "./paymentReconciler.js";
import { startStripePaymentReconciler } from "./stripePayment.js";
import leaderboardWebhookRouter from "./leaderboardWebhook.js";
import donationsRouter from "./donations.js";
import baseInvadersRouter from "./baseInvaders.js";
import { startSeasonGameRetirement } from "../bot/seasonRetirement.js";
import { repairWipeSchedule20260904 } from "../core/repairWipeSchedule20260904.js";
import vorkenIntegrationRouter from "./vorkenIntegration.js";
import { enhanceStatusHtml } from "../core/multiServerUi.js";

let backgroundStarted=false;
export function startBackgroundServices(){
 if(backgroundStarted)return;
 backgroundStarted=true;
startPaymentStatusNotifier();
startCardPaymentReconciler();
startStripePaymentReconciler();
startDuoReconciler();
startStoreReceipts();
startGiftReconciler();
startSeasonGameRetirement();
startPromoReconciler();
void repairWipeSchedule20260904().catch(error => console.error("Failed to repair 04/09 wipe schedule", error));
}


const router: IRouter = Router();
router.use((req,res,next)=>{if(!/^\/season(?:\/|\d|$)/i.test(req.path))return next();if(req.method==="GET"||req.method==="HEAD"){res.setHeader("Cache-Control","no-store");return void res.redirect(302,"/base-invaders#inscricao");}return void res.status(410).json({error:"Inscrições antigas encerradas. Acesse /base-invaders."});});
router.use(baseInvadersRouter);
router.use(healthRouter);
router.use(vorkenIntegrationRouter);

router.use((req, res, next) => {
  if (req.method !== "GET" || req.path !== "/status") return next();
  const originalSend = res.send.bind(res);
  res.send = ((body?: any) => {
    if (typeof body === "string" && /<html/i.test(body)) {
      const session = getCommunitySession(req);
      body = enhanceStatusHtml(body, req);
      body = withSiteChrome(body, "status", { isAdmin:Boolean(session?.isAdmin), username:session?.username || "" });
    }
    return originalSend(body);
  }) as any;
  next();
});

router.use(statusMultiServerRouter);
router.use(publicStatusRouter);
router.use(profileRouter);
router.use(homeMetaRouter);
router.use(leaderboardRouter);
router.use(leaderboardWebhookRouter);
router.use(donationsRouter);
router.use(pwaRouter);
router.use("/store", storeRouter);
router.use("/promo",(_req,res)=>res.status(410).json({error:"A promoção anterior foi encerrada. Conheça o Base Invaders."}));
router.use("/promo", promoParticipantDetailsRouter);
router.use("/promo", promoRouter);
router.use("/admin", adminRouter);
router.use("/community", communityRouter);
router.use("/finance", revenueView);
export default router;

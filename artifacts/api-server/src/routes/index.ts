import { Router, type IRouter } from "express";
import healthRouter from "./health";
import leaderboardRouter from "./leaderboardV2";
import adminRouter from "./admin";
import communityRouter from "./community.js";
import pwaRouter from "./pwa.js";
import revenueView from "../admin/revenueView.js";

const router: IRouter = Router();
router.use(healthRouter);
router.use(leaderboardRouter);
router.use(pwaRouter);
router.use("/admin", adminRouter);
router.use("/community", communityRouter);
router.use("/finance", revenueView);
export default router;

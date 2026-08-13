import { Router, type IRouter } from "express";
import healthRouter from "./health";
import leaderboardRouter from "./leaderboardV2";
import adminRouter from "./admin";
import revenueView from "../admin/revenueView.js";

const router: IRouter = Router();
router.use(healthRouter);
router.use(leaderboardRouter);
router.use("/admin", adminRouter);
router.use("/finance", revenueView);
export default router;

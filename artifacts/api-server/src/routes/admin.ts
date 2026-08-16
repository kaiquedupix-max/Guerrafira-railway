import { Router } from "express";
import { adminLoginV3, adminCallbackV3, adminLogoutV3 } from "../admin/oauthRoutesV3.js";
import readRoutes from "../admin/routesRead.js";
import moderationRoutes from "../admin/routesModeration.js";
import serverRoutes from "../admin/routesServer.js";
import discordRoutes from "../admin/routesDiscord.js";
import steamRoutes from "../admin/routesSteam.js";
import vipRoutes from "../admin/routesVip.js";
import leaderboardRoutes from "../admin/routesLeaderboard.js";
import financeRoutes from "../admin/routesFinance.js";
import warningRoutes from "../admin/routesWarnings.js";
import playerStateRoutes from "../admin/routesPlayerState.js";
import integrityManageRoutes from "../admin/routesIntegrityManage.js";
import notificationRoutes from "../admin/routesNotifications.js";
import wipeRoutes from "../admin/routesWipe.js";
import { requireFinanceAccess } from "../admin/financeGuard.js";

const router = Router();

router.use((req, _res, next) => {
  const auth = req.get("authorization") ?? "";
  if (auth.toLowerCase().startsWith("bearer ")) {
    const token = auth.slice(7).trim();
    if (token) req.cookies = { ...(req.cookies ?? {}), gf_admin: token };
  }
  next();
});

router.get("/auth/login", adminLoginV3);
router.get("/auth/callback", adminCallbackV3);
router.get("/auth/logout", adminLogoutV3);
router.use(readRoutes);
router.use("/moderation", moderationRoutes);
router.use("/warnings", warningRoutes);
router.use("/player-state", playerStateRoutes);
router.use("/integrity", integrityManageRoutes);
router.use("/notifications", notificationRoutes);
router.use(wipeRoutes);
router.use("/server", serverRoutes);
router.use("/discord", discordRoutes);
router.use("/steam", steamRoutes);
router.use("/vip", vipRoutes);
router.use("/leaderboard", leaderboardRoutes);
router.use("/finance", requireFinanceAccess);
router.use(financeRoutes);
export default router;

import { Router } from "express";
import { requireAdmin } from "./guard.js";
import { getAdminAlerts, getAdminDiscordNotificationState, setAdminDiscordNotifications } from "./adminNotifications.js";

const router = Router();
router.use(requireAdmin);

router.get("/alerts", (req, res) => {
  const limit = Math.max(1, Math.min(250, Number(req.query.limit) || 100));
  res.json({ alerts: getAdminAlerts(limit) });
});

router.get("/discord", async (_req, res) => {
  const admin = res.locals.admin as { userId: string };
  res.json({ enabled: await getAdminDiscordNotificationState(admin.userId) });
});

router.post("/discord", async (req, res) => {
  const admin = res.locals.admin as { userId: string };
  const enabled = Boolean(req.body?.enabled);
  await setAdminDiscordNotifications(admin.userId, enabled);
  res.json({ ok: true, enabled });
});

export default router;

import { Router } from "express";
import { requireAdmin } from "./guard.js";
import {
  getAdminAlerts,
  getAdminDiscordNotificationState,
  setAdminDiscordNotifications,
  getWebPushPublicKey,
  saveAdminWebPushSubscription,
  disableAdminWebPushSubscription,
  getAdminWebPushState,
} from "./adminNotifications.js";

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

router.get("/web-push", async (_req, res) => {
  const admin = res.locals.admin as { userId: string };
  res.json({ enabled: await getAdminWebPushState(admin.userId), publicKey: getWebPushPublicKey() });
});

router.post("/web-push", async (req, res) => {
  const admin = res.locals.admin as { userId: string };
  const sub = req.body?.subscription;
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) return res.status(400).json({ error: "Assinatura push inválida." });
  await saveAdminWebPushSubscription(admin.userId, sub);
  res.json({ ok: true, enabled: true });
});

router.delete("/web-push", async (req, res) => {
  const admin = res.locals.admin as { userId: string };
  await disableAdminWebPushSubscription(admin.userId, typeof req.body?.endpoint === "string" ? req.body.endpoint : undefined);
  res.json({ ok: true, enabled: false });
});

export default router;

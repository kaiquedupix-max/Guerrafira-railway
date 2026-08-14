import { Router } from "express";
import { db, vipSubscriptionsTable, modLogsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { discordClient } from "../bot/client.js";
import { executeRconCommand } from "../bot/utils/rcon.js";
import { grantVip, revokeVip, type VipTier } from "../bot/vip.js";
import { requireAdmin } from "./guard.js";
import { getGuerraFriaDisplayName } from "./permissions.js";

const router = Router();
router.use(requireAdmin);
const steamRe = /^7656119\d{10}$/;
const clean = (v: unknown, n = 64) => String(v ?? "").replace(/[\r\n\t]/g, " ").trim().slice(0, n);

router.post("/grant", async (req, res) => {
  const client = discordClient();
  if (!client) return res.status(503).json({ error: "Bot do Discord indisponível." });
  const steamId = clean(req.body?.steamId, 17);
  const discordUserId = clean(req.body?.discordUserId, 32);
  const tier = clean(req.body?.tier, 16) as VipTier;
  const days = Math.max(1, Math.min(365, Number(req.body?.days) || 30));
  if (!steamRe.test(steamId) || !["bronze","prata","ouro"].includes(tier)) return res.status(400).json({ error: "Dados inválidos." });

  if (discordUserId) {
    await grantVip({ discordUserId, steamId, tier, durationDays: days, source: "purchase", client });
  } else {
    const template = process.env[`VIP_${tier.toUpperCase()}_GRANT_CMD`];
    if (template) await executeRconCommand(template.replace(/\{steam[Ii][Dd]\}/g, steamId));
    await db.insert(vipSubscriptionsTable).values({ discordUserId: "manual-web", steamId, vipTier: tier, source: "purchase", durationDays: days, startsAt: new Date(), expiresAt: new Date(Date.now() + days * 86400000) });
  }

  const admin = res.locals.admin as { userId: string; username: string };
  const adminName = await getGuerraFriaDisplayName(admin.userId, admin.username);
  await db.insert(modLogsTable).values({ action: "VIP_CONCEDER", steamId, playerName: steamId, reason: `VIP ${tier} por ${days} dias`, adminId: admin.userId, adminName });
  res.json({ ok: true });
});

router.post("/revoke", async (req, res) => {
  const client = discordClient();
  if (!client) return res.status(503).json({ error: "Bot do Discord indisponível." });
  const id = Number(req.body?.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "VIP inválido." });
  const [sub] = await db.select().from(vipSubscriptionsTable).where(eq(vipSubscriptionsTable.id, id)).limit(1);
  if (!sub) return res.status(404).json({ error: "VIP não encontrado." });

  await revokeVip({ subscriptionId: sub.id, tier: sub.vipTier as VipTier, steamId: sub.steamId, discordUserId: sub.discordUserId, client });

  const admin = res.locals.admin as { userId: string; username: string };
  const adminName = await getGuerraFriaDisplayName(admin.userId, admin.username);
  await db.insert(modLogsTable).values({ action: "VIP_REMOVER", steamId: sub.steamId, playerName: sub.steamId, reason: `VIP ${sub.vipTier} removido pelo painel`, adminId: admin.userId, adminName });
  res.json({ ok: true });
});

export default router;

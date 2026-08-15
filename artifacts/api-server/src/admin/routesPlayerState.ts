import { Router } from "express";
import { db, boosterLinksTable, modLogsTable, vipSubscriptionsTable } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { ActionError, unverifyPlayer } from "../core/systemActions.js";
import { requireAdmin } from "./guard.js";

const router = Router();
router.use(requireAdmin);
const steamRe = /^7656119\d{10}$/;
const clean = (v: unknown, n = 64) => String(v ?? "").replace(/[\r\n\t]/g, " ").trim().slice(0, n);

router.get("/:steamId", async (req, res) => {
  const steamId = clean(req.params.steamId, 17);
  if (!steamRe.test(steamId)) return res.status(400).json({ error: "SteamID inválido." });
  const now = Date.now();
  const [links, vips, history, warnings] = await Promise.all([
    db.select().from(boosterLinksTable).where(eq(boosterLinksTable.steamId, steamId)).limit(1),
    db.select().from(vipSubscriptionsTable).where(eq(vipSubscriptionsTable.steamId, steamId)).orderBy(desc(vipSubscriptionsTable.expiresAt)),
    db.select().from(modLogsTable).where(eq(modLogsTable.steamId, steamId)).orderBy(desc(modLogsTable.createdAt)).limit(200),
    db.select().from(modLogsTable).where(and(eq(modLogsTable.steamId, steamId), eq(modLogsTable.action, "WARN"))),
  ]);

  const latestVerification = history.find(x => x.action === "VERIFICAR" || x.action === "REMOVER_VERIFICADO");
  const verified = latestVerification?.action === "VERIFICAR";
  const activeVip = vips.find(v => new Date(v.expiresAt).getTime() > now) ?? null;

  // O estado do ban é decidido pela ação mais recente relacionada a banimento.
  // Isso evita mostrar "banido" depois de um DESBANIR/SYSTEM_UNBAN posterior.
  const latestBanState = history.find(x => x.action === "BAN" || x.action === "DESBANIR" || x.action === "SYSTEM_UNBAN");
  const banned = latestBanState?.action === "BAN";
  const latestBan = banned ? latestBanState : null;

  res.json({
    booster: links[0] ? { active: links[0].active, discordUserId: links[0].discordUserId } : { active: false, discordUserId: null },
    vip: activeVip ? { active: true, id: activeVip.id, tier: activeVip.vipTier, expiresAt: activeVip.expiresAt, discordUserId: activeVip.discordUserId } : { active: false },
    verified,
    warnings: warnings.length,
    banned,
    ban: latestBan ? {
      duration: latestBan.banDuration,
      expiresAt: latestBan.banExpiresAt,
      reason: latestBan.reason,
      adminName: latestBan.adminName,
      createdAt: latestBan.createdAt,
    } : null,
  });
});

router.post("/unverify", async (req, res) => {
  try {
    const admin = res.locals.admin as { userId: string; username: string };
    await unverifyPlayer({
      steamId: clean(req.body?.steamId, 17),
      discordUserId: clean(req.body?.discordUserId, 32) || undefined,
      actor: { id: admin.userId, name: admin.username, source: "web" },
    });
    res.json({ ok: true });
  } catch (error) {
    const e = error instanceof ActionError ? error : new ActionError("Falha interna ao remover verificação.", 500);
    res.status(e.status).json({ error: e.message });
  }
});

export default router;

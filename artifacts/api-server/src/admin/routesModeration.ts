import { Router } from "express";
import { db, modLogsTable, playersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { executeRconCommand } from "../bot/utils/rcon.js";
import { requireAdmin } from "./guard.js";

const router = Router();
router.use(requireAdmin);
const steamRe = /^7656119\d{10}$/;
const clean = (v: unknown, n = 200) => String(v ?? "").replace(/[\r\n\t]/g, " ").trim().slice(0, n);

router.post("/ban", async (req, res) => {
  const steamId = clean(req.body?.steamId, 17);
  const duration = clean(req.body?.duration, 8);
  const reason = clean(req.body?.reason, 300);
  if (!steamRe.test(steamId) || !["3d","7d","30d","perm"].includes(duration) || !reason) return res.status(400).json({ error: "Dados inválidos." });
  const [p] = await db.select().from(playersTable).where(eq(playersTable.steamId, steamId)).limit(1);
  const name = p?.playerName ?? `Jogador (${steamId})`;
  const days = duration === "3d" ? 3 : duration === "7d" ? 7 : duration === "30d" ? 30 : 0;
  const expiresAt = days ? new Date(Date.now() + days * 86400000) : null;
  const result = await executeRconCommand(`banid ${steamId} "${name.replace(/"/g, "'")}" "[${duration.toUpperCase()}] ${reason.replace(/"/g, "'")}"`);
  const admin = res.locals.admin as { userId: string; username: string };
  await db.insert(modLogsTable).values({ action: "BAN", steamId, playerName: name, reason, adminId: admin.userId, adminName: `${admin.username} [WEB]`, banDuration: duration, banExpiresAt: expiresAt });
  res.json({ ok: true, rcon: result !== null });
});

router.post("/kick", async (req, res) => {
  const steamId = clean(req.body?.steamId, 17);
  const reason = clean(req.body?.reason, 300);
  const [p] = await db.select().from(playersTable).where(eq(playersTable.steamId, steamId)).limit(1);
  if (!steamRe.test(steamId) || !reason || !p?.isOnline) return res.status(400).json({ error: "Jogador offline ou dados inválidos." });
  const result = await executeRconCommand(`kick "${p.playerName.replace(/"/g, "'")}" "${reason.replace(/"/g, "'")}"`);
  if (result === null) return res.status(503).json({ error: "RCON indisponível." });
  const admin = res.locals.admin as { userId: string; username: string };
  await db.insert(modLogsTable).values({ action: "KICK", steamId, playerName: p.playerName, reason, adminId: admin.userId, adminName: `${admin.username} [WEB]` });
  res.json({ ok: true });
});

router.post("/unban", async (req, res) => {
  const steamId = clean(req.body?.steamId, 17);
  if (!steamRe.test(steamId)) return res.status(400).json({ error: "SteamID inválido." });
  const [p] = await db.select().from(playersTable).where(eq(playersTable.steamId, steamId)).limit(1);
  const admin = res.locals.admin as { userId: string; username: string };
  await executeRconCommand(`unban ${steamId}`);
  await db.insert(modLogsTable).values({ action: "SYSTEM_UNBAN", steamId, playerName: p?.playerName ?? steamId, reason: "Desbanido pelo painel web", adminId: admin.userId, adminName: `${admin.username} [WEB]` });
  res.json({ ok: true });
});

export default router;

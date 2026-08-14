import { Router } from "express";
import { desc } from "drizzle-orm";
import { db, playersTable, modLogsTable, boosterLinksTable, vipSubscriptionsTable } from "@workspace/db";
import { getServerInfo } from "../bot/utils/rcon.js";
import { getAdminSessionV3 } from "./sessionBearer.js";
import { requireAdmin } from "./guard.js";
import { isDiscordAdministrator } from "./permissions.js";

const router = Router();
router.use(requireAdmin);

router.get("/me", async (req, res) => {
  const session = getAdminSessionV3(req);
  const canViewFinance = session ? await isDiscordAdministrator(session.userId) : false;
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.status(200).json({ user: session, capabilities: { canViewFinance } });
});

router.get("/overview", async (_req, res) => {
  const [server, players, mods, links, vips] = await Promise.all([
    getServerInfo(),
    db.select().from(playersTable),
    db.select().from(modLogsTable).orderBy(desc(modLogsTable.createdAt)).limit(20),
    db.select().from(boosterLinksTable),
    db.select().from(vipSubscriptionsTable),
  ]);
  const now = Date.now();
  res.json({
    server,
    summary: {
      knownPlayers: players.length,
      onlinePlayers: players.filter(p => p.isOnline).length,
      linkedSteam: links.length,
      activeBoosters: links.filter(p => p.active).length,
      activeVips: vips.filter(v => new Date(v.expiresAt).getTime() > now).length,
    },
    recentModeration: mods,
  });
});

router.get("/players", async (req, res) => {
  const q = String(req.query.q ?? "").trim().toLowerCase();
  const rows = await db.select().from(playersTable).orderBy(desc(playersTable.lastSeen)).limit(1000);
  const filtered = q ? rows.filter(p => p.playerName.toLowerCase().includes(q) || p.steamId.includes(q)) : rows;
  res.json({ players: filtered.slice(0, 500) });
});

router.get("/modlogs", async (_req, res) => {
  const rows = await db.select().from(modLogsTable).orderBy(desc(modLogsTable.createdAt)).limit(200);
  res.json({ logs: rows });
});

router.get("/steam-links", async (_req, res) => {
  res.json({ links: await db.select().from(boosterLinksTable).limit(1000) });
});

router.get("/vips", async (_req, res) => {
  const rows = await db.select().from(vipSubscriptionsTable).orderBy(desc(vipSubscriptionsTable.expiresAt)).limit(500);
  res.json({ vips: rows });
});

export default router;

import { Router } from "express";
import { db, modLogsTable } from "@workspace/db";
import { desc } from "drizzle-orm";
import { getCommunitySession } from "../admin/communitySession.js";
import { getGuerraFriaDisplayName } from "../admin/permissions.js";

const router = Router();
router.use((req, res, next) => {
  const session = getCommunitySession(req);
  if (!session) return res.status(401).json({ error: "Faça login com o Discord." });
  res.locals.community = session;
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
});

router.get("/me", (_req, res) => {
  const s = res.locals.community as { userId: string; username: string; isAdmin: boolean };
  res.json({ user: { id: s.userId, username: s.username }, isAdmin: s.isAdmin });
});

router.get("/records", async (_req, res) => {
  const rows = await db.select().from(modLogsTable).orderBy(desc(modLogsTable.createdAt)).limit(2000);
  const filtered = rows.filter(x => ["WARN", "BAN", "VERIFICAR"].includes(String(x.action || "").toUpperCase()));

  const ids = [...new Set(filtered.map(x => String(x.adminId || "").trim()).filter(Boolean))];
  const resolved = new Map<string, string>();
  await Promise.all(ids.map(async id => {
    const fallback = filtered.find(x => String(x.adminId || "") === id)?.adminName || "Administração";
    resolved.set(id, await getGuerraFriaDisplayName(id, String(fallback).replace(/\s*\[WEB\]\s*$/i, "")));
  }));

  const records = filtered.map(x => ({
    ...x,
    adminName: resolved.get(String(x.adminId || "").trim()) || String(x.adminName || "Administração").replace(/\s*\[WEB\]\s*$/i, ""),
  }));

  res.json({ records });
});

export default router;

import { Router } from "express";
import { db, modLogsTable } from "@workspace/db";
import { desc } from "drizzle-orm";
import { getCommunitySession } from "../admin/communitySession.js";
import { resolveGuerraFriaDisplayNameByStoredName } from "../admin/permissions.js";

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
  const filtered = rows.filter(x => ["WARN", "BAN", "VERIFICAR"].includes(x.action));
  const names = [...new Set(filtered.map(x => String(x.adminName || "").trim()).filter(Boolean))];
  const resolved = new Map<string, string>();
  await Promise.all(names.map(async name => {
    resolved.set(name, await resolveGuerraFriaDisplayNameByStoredName(name));
  }));
  const records = filtered.map(x => ({
    ...x,
    adminName: resolved.get(String(x.adminName || "").trim()) || x.adminName || "Administração",
  }));
  res.json({ records });
});

export default router;

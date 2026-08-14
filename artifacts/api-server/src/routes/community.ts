import { Router } from "express";
import { db, modLogsTable } from "@workspace/db";
import { desc } from "drizzle-orm";
import { getCommunitySession } from "../admin/communitySession.js";

const router = Router();
router.use((req, res, next) => {
  const session = getCommunitySession(req);
  if (!session) return res.status(401).json({ error: "Faça login com o Discord." });
  res.locals.community = session;
  next();
});

router.get("/me", (req, res) => {
  const s = res.locals.community as { userId: string; username: string; isAdmin: boolean };
  res.json({ user: { id: s.userId, username: s.username }, isAdmin: s.isAdmin });
});

router.get("/records", async (_req, res) => {
  const rows = await db.select().from(modLogsTable).orderBy(desc(modLogsTable.createdAt)).limit(2000);
  const records = rows.filter(x => ["WARN", "BAN", "VERIFICAR"].includes(x.action));
  res.json({ records });
});

export default router;

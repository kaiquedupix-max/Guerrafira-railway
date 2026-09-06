import { Router } from "express";
import { db, modLogsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { getCommunitySession } from "../admin/communitySession.js";
import { getSteamProfileSummaries } from "../admin/steamProfiles.js";

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
  const rows = await db.select().from(modLogsTable).where(eq(modLogsTable.publicVisible, true)).orderBy(desc(modLogsTable.createdAt)).limit(2000);
  const filtered = rows.filter(x => ["WARN", "BAN", "VERIFICAR"].includes(String(x.action || "").toUpperCase()));
  const steamProfiles = await getSteamProfileSummaries(filtered.map(x => String(x.steamId || "")));

  const records = filtered.map(x => {
    const steam = steamProfiles.get(String(x.steamId || ""));
    const publicRecord: Record<string, unknown> = { ...x };
    delete publicRecord.adminId;
    delete publicRecord.adminName;
    return {
      ...publicRecord,
      steamProfileUrl: steam?.profileUrl ?? `https://steamcommunity.com/profiles/${x.steamId}`,
      steamAvatarUrl: steam?.avatarUrl ?? null,
      steamPersonaName: steam?.personaName ?? null,
    };
  });

  res.json({ records });
});

export default router;

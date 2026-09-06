import { Router } from "express";
import { db, modLogsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { getCommunitySession } from "../admin/communitySession.js";
import { getSteamProfileSummaries } from "../admin/steamProfiles.js";
import { discordClient } from "../bot/client.js";

const router = Router();
const MODERATOR_ROLE_ID = "1538735197611360347";
const MODERATOR_PUBLIC_LABEL = "Equipe de Moderação";

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

async function publicResponsibleNames(rows: typeof modLogsTable.$inferSelect[]): Promise<Map<string, string>> {
  const output = new Map<string, string>();
  const client = discordClient();
  const guildId = process.env.DISCORD_GUILD_ID;
  const guild = client && guildId ? await client.guilds.fetch(guildId).catch(() => null) : null;
  const adminIds = [...new Set(rows.map(x => String(x.adminId || "")).filter(Boolean))];

  await Promise.all(adminIds.map(async adminId => {
    const sample = rows.find(x => String(x.adminId || "") === adminId);
    const fallback = String(sample?.adminName || "Administração");
    if (!guild) {
      output.set(adminId, fallback);
      return;
    }
    const member = await guild.members.fetch(adminId).catch(() => null);
    if (!member) {
      output.set(adminId, fallback);
      return;
    }
    if (member.roles.cache.has(MODERATOR_ROLE_ID)) {
      output.set(adminId, MODERATOR_PUBLIC_LABEL);
      return;
    }
    output.set(
      adminId,
      member.displayName?.trim() || member.user.globalName?.trim() || member.user.username?.trim() || fallback,
    );
  }));

  return output;
}

router.get("/records", async (_req, res) => {
  const rows = await db.select().from(modLogsTable).where(eq(modLogsTable.publicVisible, true)).orderBy(desc(modLogsTable.createdAt)).limit(2000);
  const filtered = rows.filter(x => ["WARN", "BAN", "VERIFICAR"].includes(String(x.action || "").toUpperCase()));
  const [steamProfiles, responsibleNames] = await Promise.all([
    getSteamProfileSummaries(filtered.map(x => String(x.steamId || ""))),
    publicResponsibleNames(filtered),
  ]);

  const records = filtered.map(x => {
    const steam = steamProfiles.get(String(x.steamId || ""));
    const publicRecord: Record<string, unknown> = { ...x };
    const responsible = responsibleNames.get(String(x.adminId || "")) || String(x.adminName || "Administração");
    delete publicRecord.adminId;
    delete publicRecord.adminName;
    return {
      ...publicRecord,
      responsible,
      steamProfileUrl: steam?.profileUrl ?? `https://steamcommunity.com/profiles/${x.steamId}`,
      steamAvatarUrl: steam?.avatarUrl ?? null,
      steamPersonaName: steam?.personaName ?? null,
    };
  });

  res.json({ records });
});

export default router;

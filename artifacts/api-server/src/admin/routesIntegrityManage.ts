import { Router } from "express";
import { db, modLogsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { requireAdmin } from "./guard.js";
import { getGuerraFriaDisplayName } from "./permissions.js";
import { getSteamProfileSummaries } from "./steamProfiles.js";

const router = Router();
router.use(requireAdmin);

router.get("/records", async (_req, res) => {
  const rows = await db.select().from(modLogsTable).orderBy(desc(modLogsTable.createdAt)).limit(3000);
  const filtered = rows.filter(x => ["WARN", "BAN", "VERIFICAR"].includes(String(x.action || "").toUpperCase()));
  const steamProfiles = await getSteamProfileSummaries(filtered.map(x => String(x.steamId || "")));
  const records = filtered.map(x => {
    const steam = steamProfiles.get(String(x.steamId || ""));
    return {
      ...x,
      steamProfileUrl: steam?.profileUrl ?? `https://steamcommunity.com/profiles/${x.steamId}`,
      steamAvatarUrl: steam?.avatarUrl ?? null,
      steamPersonaName: steam?.personaName ?? null,
    };
  });
  res.json({ records });
});

router.post("/records/:id/visibility", async (req, res) => {
  const id = Number(req.params.id);
  const visible = req.body?.visible === true;
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Registro inválido." });

  const [record] = await db.select().from(modLogsTable).where(eq(modLogsTable.id, id)).limit(1);
  if (!record || !["WARN", "BAN", "VERIFICAR"].includes(String(record.action || "").toUpperCase())) {
    return res.status(404).json({ error: "Registro público não encontrado." });
  }

  await db.update(modLogsTable).set({ publicVisible: visible }).where(eq(modLogsTable.id, id));

  const admin = res.locals.admin as { userId: string; username: string };
  const adminName = await getGuerraFriaDisplayName(admin.userId, admin.username);
  await db.insert(modLogsTable).values({
    action: visible ? "PUBLIC_RECORD_RESTORE" : "PUBLIC_RECORD_HIDE",
    steamId: record.steamId,
    playerName: record.playerName,
    reason: `${visible ? "Restaurou" : "Ocultou"} o registro público #${record.id} (${record.action})`,
    adminId: admin.userId,
    adminName,
    publicVisible: false,
  });

  res.json({ ok: true, id, visible });
});

export default router;

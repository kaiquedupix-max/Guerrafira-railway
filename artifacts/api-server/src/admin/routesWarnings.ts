import { Router } from "express";
import { db, modLogsTable, playersTable } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { executeRconCommand } from "../bot/utils/rcon.js";
import { requireAdmin } from "./guard.js";
import { getGuerraFriaDisplayName } from "./permissions.js";

const router = Router();
router.use(requireAdmin);
const steamRe = /^7656119\d{10}$/;
const clean = (v: unknown, n = 300) => String(v ?? "").replace(/[\r\n\t]/g, " ").trim().slice(0, n);

router.get("/:steamId", async (req, res) => {
  const steamId = clean(req.params.steamId, 17);
  if (!steamRe.test(steamId)) return res.status(400).json({ error: "SteamID inválido." });
  const rows = await db.select().from(modLogsTable).where(and(eq(modLogsTable.steamId, steamId), eq(modLogsTable.action, "WARN"))).orderBy(desc(modLogsTable.createdAt));
  res.json({ warnings: rows, count: rows.length });
});

router.post("/apply", async (req, res) => {
  const steamId = clean(req.body?.steamId, 17);
  const discordUserId = clean(req.body?.discordUserId, 32);
  const reason = clean(req.body?.reason, 300);
  if (!steamRe.test(steamId) || !reason) return res.status(400).json({ error: "SteamID ou motivo inválido." });

  const [player] = await db.select().from(playersTable).where(eq(playersTable.steamId, steamId)).limit(1);
  if (!player) return res.status(404).json({ error: "Jogador não encontrado." });
  const previous = await db.select().from(modLogsTable).where(and(eq(modLogsTable.steamId, steamId), eq(modLogsTable.action, "WARN")));
  const number = previous.length + 1;
  const admin = res.locals.admin as { userId: string; username: string };
  const adminName = await getGuerraFriaDisplayName(admin.userId, admin.username);

  await db.insert(modLogsTable).values({
    action: "WARN",
    steamId,
    playerName: player.playerName,
    reason: discordUserId ? `${reason} | Discord: ${discordUserId} | Advertência ${number}/3` : `${reason} | Advertência ${number}/3`,
    adminId: admin.userId,
    adminName,
  });

  await executeRconCommand(`say <color=#FF9A2F>[ADVERTÊNCIA ${number}/3]</color> ${player.playerName}: ${reason.replace(/"/g, "'")}`).catch(() => {});

  if (number >= 3) {
    await executeRconCommand(`banid ${steamId} "${player.playerName.replace(/"/g, "'")}" "[3 ADVERTÊNCIAS] Banimento permanente | ${reason.replace(/"/g, "'")}"`).catch(() => {});
    await db.insert(modLogsTable).values({
      action: "BAN",
      steamId,
      playerName: player.playerName,
      reason: "Banimento automático após 3 advertências.",
      adminId: admin.userId,
      adminName,
      banDuration: "perm",
      banExpiresAt: null,
    });
    return res.json({ ok: true, warnings: number, banned: true });
  }

  res.json({ ok: true, warnings: number, banned: false });
});

export default router;

import { Router } from "express";
import { db, boosterLinksTable, modLogsTable, vipSubscriptionsTable } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { discordClient } from "../bot/client.js";
import { executeRconCommand } from "../bot/utils/rcon.js";
import { requireAdmin } from "./guard.js";

const router = Router();
router.use(requireAdmin);
const steamRe = /^7656119\d{10}$/;
const clean = (v: unknown, n = 64) => String(v ?? "").replace(/[\r\n\t]/g, " ").trim().slice(0, n);

router.get("/:steamId", async (req, res) => {
  const steamId = clean(req.params.steamId, 17);
  if (!steamRe.test(steamId)) return res.status(400).json({ error: "SteamID inválido." });
  const now = Date.now();
  const [links, vips, verifyLogs, warnings] = await Promise.all([
    db.select().from(boosterLinksTable).where(eq(boosterLinksTable.steamId, steamId)).limit(1),
    db.select().from(vipSubscriptionsTable).where(eq(vipSubscriptionsTable.steamId, steamId)).orderBy(desc(vipSubscriptionsTable.expiresAt)),
    db.select().from(modLogsTable).where(eq(modLogsTable.steamId, steamId)).orderBy(desc(modLogsTable.createdAt)).limit(100),
    db.select().from(modLogsTable).where(and(eq(modLogsTable.steamId, steamId), eq(modLogsTable.action, "WARN"))),
  ]);
  const latestVerification = verifyLogs.find(x => x.action === "VERIFICAR" || x.action === "REMOVER_VERIFICADO");
  const verified = latestVerification?.action === "VERIFICAR";
  const activeVip = vips.find(v => new Date(v.expiresAt).getTime() > now) ?? null;
  res.json({
    booster: links[0] ? { active: links[0].active, discordUserId: links[0].discordUserId } : { active: false, discordUserId: null },
    vip: activeVip ? { active: true, id: activeVip.id, tier: activeVip.vipTier, expiresAt: activeVip.expiresAt, discordUserId: activeVip.discordUserId } : { active: false },
    verified,
    warnings: warnings.length,
  });
});

router.post("/unverify", async (req, res) => {
  const steamId = clean(req.body?.steamId, 17);
  const discordUserId = clean(req.body?.discordUserId, 32);
  if (!steamRe.test(steamId)) return res.status(400).json({ error: "SteamID inválido." });
  await executeRconCommand((process.env.VERIFIED_GAME_REMOVE_CMD?.trim() || "oxide.usergroup remove {steamid} vr").replace(/\{steam[Ii][Dd]\}/g, steamId)).catch(() => {});
  if (discordUserId) {
    const client = discordClient();
    const guildId = process.env.DISCORD_GUILD_ID;
    const roleId = process.env.DISCORD_VERIFIED_ROLE_ID;
    if (client && guildId && roleId) {
      const guild = await client.guilds.fetch(guildId).catch(() => null);
      const member = guild ? await guild.members.fetch(discordUserId).catch(() => null) : null;
      if (member?.roles.cache.has(roleId)) await member.roles.remove(roleId, "Removido pelo Painel Web").catch(() => {});
    }
  }
  const admin = res.locals.admin as { userId: string; username: string };
  await db.insert(modLogsTable).values({ action: "REMOVER_VERIFICADO", steamId, playerName: steamId, reason: discordUserId ? `Discord: ${discordUserId}` : "Removido pelo painel", adminId: admin.userId, adminName: `${admin.username} [WEB]` });
  res.json({ ok: true });
});

export default router;

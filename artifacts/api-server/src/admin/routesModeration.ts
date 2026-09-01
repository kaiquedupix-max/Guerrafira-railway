import { Router } from "express";
import { requireAdmin } from "./guard.js";
import { getGuerraFriaDisplayName } from "./permissions.js";
import { discordClient } from "../bot/client.js";
import { ActionError, banPlayer, kickPlayer, preventiveBanPlayer, unbanPlayer, verifyPlayer, type BanDuration } from "../core/systemActions.js";

const router = Router();
router.use(requireAdmin);
const clean = (v: unknown, n = 300) => String(v ?? "").replace(/[\r\n\t]/g, " ").trim().slice(0, n);
const ANONYMOUS_MODERATOR_ROLE_ID = "1538735197611360347";
const ANONYMOUS_MODERATOR_LABEL = "Moderador do servidor";

async function hasAnonymousModeratorRole(userId: string): Promise<boolean> {
  const client = discordClient();
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!client || !guildId) return false;

  const guild = await client.guilds.fetch(guildId).catch(() => null);
  const member = guild ? await guild.members.fetch(userId).catch(() => null) : null;
  return member?.roles.cache.has(ANONYMOUS_MODERATOR_ROLE_ID) ?? false;
}

async function actor(res: any) {
  const admin = res.locals.admin as { userId: string; username: string };
  const anonymous = await hasAnonymousModeratorRole(admin.userId);
  if (anonymous) {
    return { id: admin.userId, name: ANONYMOUS_MODERATOR_LABEL, source: "system" as const };
  }

  return { id: admin.userId, name: await getGuerraFriaDisplayName(admin.userId, admin.username), source: "web" as const };
}
const fail = (res: any, error: unknown) => {
  const e = error instanceof ActionError ? error : new ActionError("Falha interna ao executar a ação.", 500);
  return res.status(e.status).json({ error: e.message });
};

router.post("/ban", async (req, res) => {
  try {
    const duration = clean(req.body?.duration, 8) as BanDuration;
    if (!["3d","7d","30d","perm"].includes(duration)) throw new ActionError("Duração inválida.");
    const result = await banPlayer({ steamId: clean(req.body?.steamId, 17), duration, reason: clean(req.body?.reason), actor: await actor(res) });
    res.json({ ok: true, ...result });
  } catch (error) { fail(res, error); }
});
router.post("/preventive-ban", async (req, res) => {
  try {
    const result = await preventiveBanPlayer({
      steamId: clean(req.body?.steamId, 17),
      reason: clean(req.body?.reason),
      actor: await actor(res),
    });
    res.json({ ok: true, ...result });
  } catch (error) { fail(res, error); }
});
router.post("/kick", async (req, res) => {
  try { res.json({ ok: true, ...(await kickPlayer({ steamId: clean(req.body?.steamId, 17), reason: clean(req.body?.reason), actor: await actor(res) })) }); }
  catch (error) { fail(res, error); }
});
router.post("/unban", async (req, res) => {
  try { res.json({ ok: true, ...(await unbanPlayer({ steamId: clean(req.body?.steamId, 17), reason: clean(req.body?.reason), actor: await actor(res) })) }); }
  catch (error) { fail(res, error); }
});
router.post("/verify", async (req, res) => {
  try { res.json({ ok: true, ...(await verifyPlayer({ steamId: clean(req.body?.steamId, 17), discordUserId: clean(req.body?.discordUserId, 32), actor: await actor(res) })) }); }
  catch (error) { fail(res, error); }
});
export default router;

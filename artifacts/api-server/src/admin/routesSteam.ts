import { Router } from "express";
import { db, boosterLinksTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { executeRconRequired, ActionError } from "../core/systemActions.js";
import { setBoosterAccess, unlinkSteamAccess } from "../core/accessActions.js";
import { requireAdmin } from "./guard.js";

const router = Router();
router.use(requireAdmin);
const steamRe = /^7656119\d{10}$/;
const clean = (v: unknown, n = 64) => String(v ?? "").replace(/[\r\n\t]/g, " ").trim().slice(0, n);

router.post("/change", async (req, res) => {
  const discordUserId = clean(req.body?.discordUserId, 32);
  const steamId = clean(req.body?.steamId, 17);
  if (!discordUserId || !steamRe.test(steamId)) return res.status(400).json({ error: "Dados inválidos." });
  const [current] = await db.select().from(boosterLinksTable).where(eq(boosterLinksTable.discordUserId, discordUserId)).limit(1);
  const [owner] = await db.select().from(boosterLinksTable).where(eq(boosterLinksTable.steamId, steamId)).limit(1);
  if (owner && owner.discordUserId !== discordUserId) return res.status(409).json({ error: "SteamID já vinculado a outro Discord." });
  if (current?.active && current.steamId !== steamId) {
    await executeRconRequired(`c.usergroup remove ${current.steamId} bs`);
    try { await executeRconRequired(`c.usergroup add ${steamId} bs`); } catch (error) { await executeRconRequired(`c.usergroup add ${current.steamId} bs`).catch(() => {}); throw error; }
  }
  if (current) await db.update(boosterLinksTable).set({ steamId, updatedAt: new Date() }).where(eq(boosterLinksTable.discordUserId, discordUserId));
  else await db.insert(boosterLinksTable).values({ discordUserId, steamId, active: false, updatedAt: new Date() });
  res.json({ ok: true });
});

router.post("/unlink", async (req, res) => {
  try { res.json({ ok: true, ...(await unlinkSteamAccess(clean(req.body?.discordUserId, 32))) }); }
  catch (error) { const e = error instanceof ActionError ? error : new ActionError("Falha ao desvincular Steam.", 500); res.status(e.status).json({ error: e.message }); }
});

router.post("/booster", async (req, res) => {
  try {
    res.json({ ok: true, ...(await setBoosterAccess(clean(req.body?.discordUserId, 32), Boolean(req.body?.active), "Painel Web")) });
  } catch (error) {
    const e = error instanceof ActionError ? error : new ActionError("Falha ao alterar Booster.", 500);
    res.status(e.status).json({ error: e.message });
  }
});

export default router;

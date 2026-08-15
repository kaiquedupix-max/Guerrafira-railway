import { Router } from "express";
import { db, boosterLinksTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { executeRconCommand } from "../bot/utils/rcon.js";
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
    await executeRconCommand(`oxide.usergroup remove ${current.steamId} bs`).catch(() => {});
    await executeRconCommand(`oxide.usergroup add ${steamId} bs`).catch(() => {});
  }
  if (current) await db.update(boosterLinksTable).set({ steamId, updatedAt: new Date() }).where(eq(boosterLinksTable.discordUserId, discordUserId));
  else await db.insert(boosterLinksTable).values({ discordUserId, steamId, active: false, updatedAt: new Date() });
  res.json({ ok: true });
});

router.post("/unlink", async (req, res) => {
  const discordUserId = clean(req.body?.discordUserId, 32);
  const [current] = await db.select().from(boosterLinksTable).where(eq(boosterLinksTable.discordUserId, discordUserId)).limit(1);
  if (!current) return res.status(404).json({ error: "Vínculo não encontrado." });
  if (current.active) await executeRconCommand(`oxide.usergroup remove ${current.steamId} bs`).catch(() => {});
  await db.delete(boosterLinksTable).where(eq(boosterLinksTable.discordUserId, discordUserId));
  res.json({ ok: true });
});

router.post("/booster", async (req, res) => {
  const discordUserId = clean(req.body?.discordUserId, 32);
  const active = Boolean(req.body?.active);
  const [current] = await db.select().from(boosterLinksTable).where(eq(boosterLinksTable.discordUserId, discordUserId)).limit(1);
  if (!current) return res.status(404).json({ error: "Discord sem Steam vinculada." });
  await executeRconCommand(`oxide.usergroup ${active ? "add" : "remove"} ${current.steamId} bs`);
  await db.update(boosterLinksTable).set({ active, manuallyDisabled: !active, updatedAt: new Date() }).where(eq(boosterLinksTable.discordUserId, discordUserId));
  res.json({ ok: true });
});

export default router;

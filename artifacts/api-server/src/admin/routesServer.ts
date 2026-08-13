import { Router } from "express";
import { executeRconCommand, getOnlinePlayers, getServerInfo } from "../bot/utils/rcon.js";
import { requireAdmin } from "./guard.js";
import { addModeratorChat, getLiveChat, getLiveEvents, initLiveOps } from "./liveOps.js";

const router = Router();
router.use(requireAdmin);
initLiveOps();
const steamRe = /^7656119\d{10}$/;
const clean = (v: unknown, n = 300) => String(v ?? "").replace(/[\r\n\t]/g, " ").trim().slice(0, n);

router.get("/online", async (_req, res) => {
  const [players, info] = await Promise.all([getOnlinePlayers().catch(() => []), getServerInfo().catch(() => null)]);
  res.json({ players, info });
});
router.get("/chat", (_req, res) => res.json({ messages: getLiveChat() }));
router.post("/chat", async (req, res) => {
  const message = clean(req.body?.message, 220);
  if (!message) return res.status(400).json({ error: "Mensagem vazia." });
  const admin = res.locals.admin as { username?: string };
  const moderator = clean(admin?.username || "Moderador", 40);
  const formatted = `<color=#FFD84D>[MODERAÇÃO]</color> <color=#A78BFA>${moderator}</color>: ${message}`;
  const result = await executeRconCommand(`say ${formatted}`);
  if (result === null) return res.status(503).json({ error: "RCON indisponível." });
  addModeratorChat(`MOD • ${moderator}`, message);
  res.json({ ok: true });
});
router.get("/events", (_req, res) => res.json({ events: getLiveEvents() }));

router.post("/say", async (req, res) => {
  const message = clean(req.body?.message, 220);
  if (!message) return res.status(400).json({ error: "Mensagem vazia." });
  const result = await executeRconCommand(`say ${message}`);
  res.json({ ok: result !== null, result });
});
router.post("/give", async (req, res) => {
  const steamId = clean(req.body?.steamId, 17);
  const item = clean(req.body?.item, 80);
  const amount = Math.max(1, Math.min(100000, Number(req.body?.amount) || 1));
  if (!steamRe.test(steamId) || !/^[a-z0-9._-]+$/i.test(item)) return res.status(400).json({ error: "SteamID ou item inválido." });
  const result = await executeRconCommand(`inventory.giveto ${steamId} ${item} ${amount}`);
  res.json({ ok: result !== null, result });
});
router.post("/clear-inventory", async (req, res) => {
  const steamId = clean(req.body?.steamId, 17);
  if (!steamRe.test(steamId)) return res.status(400).json({ error: "SteamID inválido." });
  const result = await executeRconCommand(`inventory.clearinventory ${steamId}`);
  res.json({ ok: result !== null, result });
});
router.post("/teleport", async (req, res) => {
  const from = clean(req.body?.from, 17);
  const to = clean(req.body?.to, 17);
  if (!steamRe.test(from) || !steamRe.test(to)) return res.status(400).json({ error: "SteamID inválido." });
  const result = await executeRconCommand(`teleport ${from} ${to}`);
  res.json({ ok: result !== null, result });
});
router.post("/spawn", async (req, res) => {
  const entity = clean(req.body?.entity, 120);
  if (!/^[a-z0-9_./-]+$/i.test(entity)) return res.status(400).json({ error: "Entidade inválida." });
  const result = await executeRconCommand(`spawn ${entity}`);
  res.json({ ok: result !== null, result });
});
router.post("/rcon", async (req, res) => {
  const command = clean(req.body?.command, 500);
  if (!command) return res.status(400).json({ error: "Comando vazio." });
  const blocked = /^(quit|restart|server\.identity|rcon\.)\b/i.test(command);
  if (blocked) return res.status(403).json({ error: "Este comando crítico foi bloqueado no painel web." });
  const result = await executeRconCommand(command);
  res.json({ ok: result !== null, result });
});
export default router;

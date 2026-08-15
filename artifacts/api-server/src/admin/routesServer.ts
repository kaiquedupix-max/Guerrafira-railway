import { Router } from "express";
import { executeRconCommand, getOnlinePlayers, getServerInfo } from "../bot/utils/rcon.js";
import { ActionError, executeRconRequired } from "../core/systemActions.js";
import { getSlotControlSettings, updateSlotControlSettings } from "../bot/slotManager.js";
import { requireAdmin } from "./guard.js";
import { addModeratorChat, getLiveChat, getLiveEvents, initLiveOps } from "./liveOps.js";
import { getGuerraFriaDisplayName } from "./permissions.js";
import { notifySubscribedAdmins } from "./adminNotifications.js";

const router = Router();
router.use(requireAdmin);
initLiveOps();
const steamRe = /^7656119\d{10}$/;
const clean = (v: unknown, n = 300) => String(v ?? "").replace(/[\r\n\t]/g, " ").trim().slice(0, n);
let itemCache: Array<{ id: number; shortname: string; name: string; category?: string; stack?: number }> = [];
let itemCacheAt = 0;

router.get("/online", async (_req, res) => {
  const [players, info] = await Promise.all([getOnlinePlayers().catch(() => []), getServerInfo().catch(() => null)]);
  res.json({ players, info });
});

router.get("/slot-control", async (_req, res) => {
  try {
    const [settings, info] = await Promise.all([
      getSlotControlSettings(),
      getServerInfo().catch(() => null),
    ]);
    res.json({ settings, info });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || "Não foi possível carregar o controle de slots." });
  }
});

router.post("/slot-control", async (req, res) => {
  const admin = res.locals.admin as { userId?: string; username?: string };
  try {
    const mode = req.body?.mode === "manual" ? "manual" : "automatic";
    const minSlots = Number(req.body?.minSlots);
    const maxSlots = Number(req.body?.maxSlots);
    const manualSlots = Number(req.body?.manualSlots);
    const displayName = admin.userId
      ? await getGuerraFriaDisplayName(admin.userId, admin.username || "Administrador")
      : (admin.username || "Administrador");

    const result = await updateSlotControlSettings({
      mode,
      minSlots,
      maxSlots,
      manualSlots,
      updatedBy: displayName,
    });

    const description = mode === "automatic"
      ? `${displayName} ativou o controle automático de slots (${result.settings.minSlots}–${result.settings.maxSlots}).`
      : `${displayName} definiu o controle manual em ${result.settings.manualSlots} slots.`;

    void notifySubscribedAdmins({
      kind: "system",
      title: "🎛️ Controle de slots alterado",
      message: description,
      severity: "info",
    }).catch(() => {});

    res.json({ ok: true, ...result });
  } catch (error: any) {
    res.status(400).json({ error: error?.message || "Configuração de slots inválida." });
  }
});

router.get("/items", async (req, res) => {
  const q = clean(req.query.q, 80).toLowerCase();
  if (!itemCache.length || Date.now() - itemCacheAt > 15 * 60_000) {
    const raw = await executeRconCommand("gf.items").catch(() => null);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          itemCache = parsed.filter(x => x && x.shortname && x.name);
          itemCacheAt = Date.now();
        }
      } catch {}
    }
  }
  if (!itemCache.length) return res.status(503).json({ error: "Catálogo de itens indisponível. Instale o plugin GuerraFriaItemCatalog.cs no servidor Rust.", items: [] });
  const items = (q ? itemCache.filter(x => String(x.name).toLowerCase().includes(q) || String(x.shortname).toLowerCase().includes(q) || String(x.category ?? "").toLowerCase().includes(q)) : itemCache).slice(0, 80);
  res.json({ items, total: itemCache.length });
});

router.get("/chat", (_req, res) => res.json({ messages: getLiveChat() }));
router.post("/chat", async (req, res) => {
  const message = clean(req.body?.message, 220);
  if (!message) return res.status(400).json({ error: "Mensagem vazia." });

  const admin = res.locals.admin as { userId?: string; username?: string };
  const displayName = admin.userId ? await getGuerraFriaDisplayName(admin.userId, admin.username || "Administrador") : (admin.username || "Administrador");
  const safeAdmin = clean(displayName, 40).replace(/"/g, "'");
  const safeMessage = message.replace(/"/g, "'");

  const formatted = `<color=#FFD84D>[GUERRA FRIA]</color> <color=#FF3B30>[ADMINISTRAÇÃO]</color> <color=#FF9500>${safeAdmin}</color>: <color=#E9D5FF>${safeMessage}</color>`;
  addModeratorChat(`ADMINISTRAÇÃO • ${safeAdmin}`, message);

  let result = await executeRconCommand(`say "${formatted}"`).catch(() => null);
  if (result === null) result = await executeRconCommand(`global.say "${formatted}"`).catch(() => null);

  if (result === null) return res.status(503).json({ error: "O RCON não confirmou o envio da mensagem ao jogo." });
  res.json({ ok: true, rcon: true });
});
router.get("/events", (_req, res) => res.json({ events: getLiveEvents() }));

async function runGameCommand(res: any, command: string): Promise<void> {
  try {
    const result = await executeRconRequired(command);
    res.json({ ok: true, result });
  } catch (error) {
    const e = error instanceof ActionError ? error : new ActionError("O servidor não confirmou o comando.", 503);
    res.status(e.status).json({ error: e.message });
  }
}

router.post("/say", async (req, res) => {
  const message = clean(req.body?.message, 220);
  if (!message) return res.status(400).json({ error: "Mensagem vazia." });
  await runGameCommand(res, `say ${message}`);
});
router.post("/give", async (req, res) => {
  const steamId = clean(req.body?.steamId, 17), item = clean(req.body?.item, 80), amount = Math.max(1, Math.min(100000, Number(req.body?.amount) || 1));
  if (!steamRe.test(steamId) || !/^[a-z0-9._-]+$/i.test(item)) return res.status(400).json({ error: "SteamID ou item inválido." });
  await runGameCommand(res, `inventory.giveto ${steamId} ${item} ${amount}`);
});
router.post("/clear-inventory", async (req, res) => {
  const steamId = clean(req.body?.steamId, 17);
  if (!steamRe.test(steamId)) return res.status(400).json({ error: "SteamID inválido." });
  await runGameCommand(res, `inventory.clearinventory ${steamId}`);
});
router.post("/teleport", async (req, res) => {
  const from = clean(req.body?.from, 17), to = clean(req.body?.to, 17);
  if (!steamRe.test(from) || !steamRe.test(to)) return res.status(400).json({ error: "SteamID inválido." });
  await runGameCommand(res, `teleport ${from} ${to}`);
});
router.post("/spawn", async (req, res) => {
  const entity = clean(req.body?.entity, 120);
  if (!/^[a-z0-9_./-]+$/i.test(entity)) return res.status(400).json({ error: "Entidade inválida." });
  await runGameCommand(res, `spawn ${entity}`);
});
router.post("/rcon", async (req, res) => {
  const command = clean(req.body?.command, 500);
  if (!command) return res.status(400).json({ error: "Comando vazio." });
  if (/^(quit|restart|server\.identity|rcon\.)\b/i.test(command)) return res.status(403).json({ error: "Este comando crítico foi bloqueado no painel web." });
  await runGameCommand(res, command);
});
export default router;

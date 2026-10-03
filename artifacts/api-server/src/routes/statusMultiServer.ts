import { Router, type IRouter } from "express";
import WebSocket from "ws";

const router: IRouter = Router();

type ServerId = "solo-duo" | "trio";
type RconResponse = { Identifier?: number; Message?: string };

function placeholder(value: unknown): boolean {
  const v = String(value ?? "").trim();
  if (!v) return true;
  const lower = v.toLowerCase();
  return lower.includes("seu_") || lower.includes("your_") || lower.includes("changeme") || lower.includes("example") || lower === "0.0.0.0";
}

export function trioReady(): boolean {
  return !placeholder(process.env.TRIO_RCON_HOST)
    && !placeholder(process.env.TRIO_RCON_PASSWORD)
    && !placeholder(process.env.TRIO_RUST_SERVER_HOST)
    && !placeholder(process.env.TRIO_RUST_SERVER_PORT);
}

export function selectedServer(value: unknown): ServerId {
  return String(value || "").toLowerCase() === "trio" ? "trio" : "solo-duo";
}

function wipeWindow(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find(p => p.type === t)?.value || "";
  const local = new Date(`${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:00-03:00`);
  const candidates: Date[] = [];
  for (let d = -7; d <= 7; d++) {
    const x = new Date(local.getTime() + d * 86400000);
    const day = x.getDay();
    if (day === 1 || day === 5) { x.setHours(18, 30, 0, 0); candidates.push(x); }
  }
  return {
    last: candidates.filter(x => x <= local).sort((a,b) => b.getTime() - a.getTime())[0]?.toISOString() || null,
    next: candidates.filter(x => x > local).sort((a,b) => a.getTime() - b.getTime())[0]?.toISOString() || null,
  };
}

function trioCommand(command: string): Promise<string | null> {
  if (!trioReady()) return Promise.resolve(null);
  const host = String(process.env.TRIO_RCON_HOST || "").trim();
  const port = String(process.env.TRIO_RCON_PORT || "28016").trim() || "28016";
  const password = String(process.env.TRIO_RCON_PASSWORD || "").trim();
  return new Promise(resolve => {
    let done = false;
    let socket: WebSocket;
    const identifier = Math.floor(Math.random() * 2_000_000_000) + 1;
    const finish = (value: string | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { socket?.terminate(); } catch {}
      resolve(value);
    };
    socket = new WebSocket(`ws://${host}:${port}/${password}`);
    const timer = setTimeout(() => finish(null), 3500);
    socket.on("open", () => socket.send(JSON.stringify({ Identifier: identifier, Message: command, Name: "WebRcon" })));
    socket.on("message", raw => {
      try {
        const msg = JSON.parse(raw.toString()) as RconResponse;
        if (msg.Identifier === identifier) finish(String(msg.Message ?? ""));
      } catch {}
    });
    socket.on("error", () => finish(null));
    socket.on("close", () => finish(null));
  });
}

async function trioServerInfo() {
  const raw = await trioCommand("serverinfo");
  if (!raw) return null;
  try {
    const data: any = JSON.parse(raw);
    const num = (...values: unknown[]) => {
      for (const value of values) {
        const parsed = Number(value);
        if (Number.isFinite(parsed) && parsed >= 0) return parsed;
      }
      return 0;
    };
    let sleepers = num(data.Sleepers, data.SleepingPlayers, data.sleepers, data.sleepingPlayers);
    if (!sleepers) {
      const sleeping = await trioCommand("sleepingusers");
      if (sleeping) {
        try { const parsed = JSON.parse(sleeping); if (Array.isArray(parsed)) sleepers = parsed.length; } catch {}
      }
    }
    return {
      hostname: String(data.Hostname ?? data.hostname ?? "Guerra Fria Trio"),
      players: num(data.Players, data.players, data.PlayerCount),
      maxPlayers: num(data.MaxPlayers, data.maxPlayers, data.maxplayers, data.Capacity),
      queued: num(data.Queued, data.queued, data.Queue, data.QueueSize),
      joining: num(data.Joining, data.joining, data.JoiningPlayers),
      sleepers,
      map: String(data.Map ?? data.map ?? "—"),
      gameTime: String(data.GameTime ?? data.gameTime ?? "—"),
    };
  } catch { return null; }
}

router.get("/status/servers", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({
    servers: [
      { id: "solo-duo", name: "Solo/Duo", available: true, comingSoon: false },
      { id: "trio", name: "Trio", available: trioReady(), comingSoon: !trioReady() },
    ],
  });
});

router.get("/status/data", async (req, res, next) => {
  if (selectedServer(req.query.server) !== "trio") return next();
  res.setHeader("Cache-Control", "no-store");
  const ready = trioReady();
  const wipe = wipeWindow();
  if (!ready) {
    return void res.json({
      serverId: "trio", serverName: "Guerra Fria Trio", configured: false, comingSoon: true,
      online: false, state: "coming_soon", hostname: "Guerra Fria Trio • Em breve",
      players: 0, maxPlayers: 0, queued: 0, joining: 0, sleepers: 0,
      map: "Em breve", gameTime: "—", uptimeMs: 0, lastWipe: null, nextWipe: null,
      updatedAt: new Date().toISOString(),
    });
  }
  const info = await trioServerInfo();
  return void res.json({
    serverId: "trio", serverName: "Guerra Fria Trio", configured: true, comingSoon: false,
    online: Boolean(info), state: info ? "running" : "offline",
    hostname: info?.hostname || "Guerra Fria Trio", players: info?.players ?? 0,
    maxPlayers: info?.maxPlayers ?? 0, queued: info?.queued ?? 0, joining: info?.joining ?? 0,
    sleepers: info?.sleepers ?? 0, map: info?.map || "—", gameTime: info?.gameTime || "—",
    uptimeMs: 0, lastWipe: wipe.last, nextWipe: wipe.next, updatedAt: new Date().toISOString(),
  });
});

router.get("/status/events", async (req, res, next) => {
  if (selectedServer(req.query.server) !== "trio") return next();
  res.setHeader("Cache-Control", "no-store");
  if (!trioReady()) return void res.json({ serverId: "trio", comingSoon: true, events: [], updatedAt: new Date().toISOString() });
  const raw = await trioCommand("gf.events");
  let events: unknown[] = [];
  if (raw) {
    try { const parsed: any = JSON.parse(raw); events = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.events) ? parsed.events : []; } catch {}
  }
  return void res.json({ serverId: "trio", comingSoon: false, events, updatedAt: new Date().toISOString() });
});

export default router;

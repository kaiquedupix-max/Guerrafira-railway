import { serverWipeWindow } from "../core/wipeCalendar.js";
import { withAdminServer } from "../core/adminServerContext.js";
import { getHostResourceSnapshot } from "../core/hostWipe.js";
import { Router, type IRouter } from "express";
import { executeServerRcon } from "../bot/utils/serverRcon.js";
import { cachedRead } from "../core/readCache.js";

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

function wipeWindow(now = new Date()) { const window=serverWipeWindow("trio",now);return {last:window.last?new Date(window.last).toISOString():null,next:window.next?new Date(window.next).toISOString():null}; }

function trioCommand(command:string):Promise<string|null>{
  if(!trioReady())return Promise.resolve(null);
  return withAdminServer("trio",()=>cachedRead("status-rcon:"+command,async()=>{
    const reply=await executeServerRcon("trio",command);
    if(reply===null)throw new Error("Trio status unavailable");
    return reply;
  },5000,0)).catch(()=>null);
}

async function trioServerInfo() {
  const raw = await trioCommand("serverinfo");
  if (!raw) return null;
  try {
    const data: any = JSON.parse(raw);
    const num = (...values: unknown[]) => {
      for (const value of values) {
        if(value===null||value===undefined||value==="")continue;
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

async function trioHostState(): Promise<string | null> {
  try {
    const resource = await withAdminServer("trio", () => cachedRead("public-host-status",()=>getHostResourceSnapshot(),5000,0));
    return String(resource.state || "").toLowerCase() || null;
  } catch {
    return null;
  }
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
  const [info, hostState] = await Promise.all([trioServerInfo(), trioHostState()]);
  const hostOnline = hostState === "running" || hostState === "starting";
  const online = Boolean(info) || hostOnline;
  const state = online ? "running" : hostState === "offline" ? "offline" : "unavailable";
  return void res.json({
    serverId: "trio", serverName: "Guerra Fria Trio", configured: true, comingSoon: false,
    online, state,
    hostname: info?.hostname || "Guerra Fria Trio", players: info?.players ?? 0,
    maxPlayers: info?.maxPlayers ?? 0, queued: info?.queued ?? 0, joining: info?.joining ?? 0,
    sleepers: info?.sleepers ?? 0, map: info?.map || "—", gameTime: info?.gameTime || "—",
    uptimeMs: 0, lastWipe: wipe.last, nextWipe: wipe.next, updatedAt: new Date().toISOString(),
    statusSource: info ? "rcon" : hostOnline ? "host" : "unavailable",
    rconAvailable: Boolean(info), hostState,
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

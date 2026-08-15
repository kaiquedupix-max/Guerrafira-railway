/** Rust WebRCON client — WebSocket-based RCON + broadcast event system. */
import WebSocket from "ws";
import { logger } from "../../lib/logger.js";

interface RconMessage { Identifier: number; Message: string; Name: string; }
interface RconResponse { Identifier: number; Message: string; Type: string; Stacktrace: string; }
type RconEventHandler = (type: string, message: string) => void;
const rconEventHandlers = new Set<RconEventHandler>();

export function setRconEventHandler(handler: RconEventHandler): void { rconEventHandlers.add(handler); }
export function addRconEventHandler(handler: RconEventHandler): () => void {
  rconEventHandlers.add(handler);
  return () => rconEventHandlers.delete(handler);
}

let ws: WebSocket | null = null;
let wsReady = false;
let connectionPromise: Promise<boolean> | null = null;
const pendingResolvers = new Map<number, { resolve: (v: string) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
let messageId = 1;

function getRconUrl(): string | null {
  const host = process.env.RCON_HOST;
  const port = process.env.RCON_PORT ?? "28016";
  const password = process.env.RCON_PASSWORD;
  if (!host || !password) return null;
  return `ws://${host}:${port}/${password}`;
}

function _doConnect(): Promise<boolean> {
  const url = getRconUrl();
  if (!url) return Promise.resolve(false);
  return new Promise(resolve => {
    if (ws) { ws.terminate(); ws = null; wsReady = false; }
    const socket = new WebSocket(url);
    const connectTimeout = setTimeout(() => { logger.error("RCON WebSocket connection timed out"); socket.terminate(); resolve(false); }, 8000);
    socket.on("open", () => { clearTimeout(connectTimeout); ws = socket; wsReady = true; logger.info({ host: process.env.RCON_HOST }, "RCON WebSocket connected"); resolve(true); });
    socket.on("message", data => {
      try {
        const msg = JSON.parse(data.toString()) as RconResponse;
        const pending = pendingResolvers.get(msg.Identifier);
        if (pending) { clearTimeout(pending.timer); pendingResolvers.delete(msg.Identifier); pending.resolve(msg.Message); return; }
        if (msg.Message) {
          for (const handler of rconEventHandlers) {
            try { handler(msg.Type ?? "", msg.Message); }
            catch (err) { logger.error({ err }, "RCON event handler error"); }
          }
        }
      } catch {}
    });
    socket.on("error", err => { logger.error({ err }, "RCON WebSocket error"); wsReady = false; });
    socket.on("close", () => { logger.warn("RCON WebSocket closed"); ws = null; wsReady = false; for (const [, pending] of pendingResolvers) { clearTimeout(pending.timer); pending.reject(new Error("RCON connection closed")); } pendingResolvers.clear(); });
  });
}

async function ensureConnected(): Promise<boolean> {
  if (ws && wsReady) return true;
  if (connectionPromise) return connectionPromise;
  connectionPromise = _doConnect().finally(() => { connectionPromise = null; });
  return connectionPromise;
}

export async function executeRconCommand(command: string): Promise<string | null> {
  const connected = await ensureConnected();
  if (!connected || !ws) { logger.warn({ command }, "RCON not connected — skipping command"); return null; }
  const id = messageId++;
  const payload: RconMessage = { Identifier: id, Message: command, Name: "WebRcon" };
  return new Promise(resolve => {
    const timer = setTimeout(() => { pendingResolvers.delete(id); logger.warn({ command }, "RCON command timed out"); resolve(null); }, 10000);
    pendingResolvers.set(id, { resolve: v => resolve(v), reject: () => resolve(null), timer });
    ws!.send(JSON.stringify(payload), err => { if (err) { clearTimeout(timer); pendingResolvers.delete(id); logger.error({ err, command }, "RCON send error"); resolve(null); } });
  });
}

export interface RconPlayer { steamId: string; name: string; ping: number; }
export async function getOnlinePlayers(): Promise<RconPlayer[]> {
  const response = await executeRconCommand("playerlist");
  if (!response) return [];
  try {
    const raw = JSON.parse(response) as Array<{ SteamID: string; DisplayName?: string; Username?: string; Ping: number }>;
    return raw.map(p => ({ steamId: p.SteamID, name: (p.DisplayName ?? p.Username ?? "Unknown").trim() || "Unknown", ping: p.Ping }));
  } catch { return []; }
}

export interface ServerInfo { hostname: string; maxPlayers: number; players: number; queued: number; joining: number; sleepers: number; map: string; gameTime: string; }

export async function getServerInfo(): Promise<ServerInfo | null> {
  const infoRaw = await executeRconCommand("serverinfo");
  if (!infoRaw) return null;
  try {
    const raw = JSON.parse(infoRaw) as Record<string, unknown>;
    const numberFrom = (...values: unknown[]): number => {
      for (const value of values) {
        const parsed = Number(value);
        if (Number.isFinite(parsed) && parsed >= 0) return parsed;
      }
      return 0;
    };
    const sleepers = numberFrom(raw.Sleepers, raw.SleepingPlayers, raw.Sleeping, raw.sleepers, raw.sleepingPlayers);
    return {
      hostname: String(raw.Hostname ?? raw.hostname ?? "Servidor"),
      maxPlayers: numberFrom(raw.MaxPlayers, raw.maxPlayers, raw.maxplayers, raw.Capacity),
      players: numberFrom(raw.Players, raw.players, raw.PlayerCount, raw.playerCount),
      queued: numberFrom(raw.Queued, raw.queued, raw.Queue, raw.queue, raw.QueuedPlayers, raw.queuedPlayers, raw.QueueSize, raw.queueSize),
      joining: numberFrom(raw.Joining, raw.joining, raw.JoiningPlayers, raw.joiningPlayers),
      sleepers,
      map: String(raw.Map ?? "—"),
      gameTime: String(raw.GameTime ?? "—"),
    };
  } catch (err) { logger.error({ err, infoRaw }, "Failed to parse serverinfo"); return null; }
}

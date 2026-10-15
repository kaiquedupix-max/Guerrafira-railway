import WebSocket from "ws";
import { executeDuoRconCommand } from "./rcon.js";
import type { GuerraFriaServerId } from "../../core/servers.js";
import { logger } from "../../lib/logger.js";

type TrioEventHandler = (type: string, message: string) => void;
const trioEventHandlers = new Set<TrioEventHandler>();
export function addTrioRconEventHandler(handler: TrioEventHandler): () => void {
  trioEventHandlers.add(handler);
  return () => { trioEventHandlers.delete(handler); };
}

type Pending = { finish: (value: string | null) => void };
let trioSocket: WebSocket | null = null;
let trioConnecting: Promise<WebSocket | null> | null = null;
let connectionUrl = "";
let identifier = 1;
const pending = new Map<number, Pending>();

function disconnect(socket: WebSocket): void {
  // Delayed events from an old socket must not close the replacement connection.
  if (trioSocket !== socket) return;
  trioSocket = null;
  for (const request of [...pending.values()]) request.finish(null);
  socket.terminate();
}

async function connectTrio(): Promise<WebSocket | null> {
  const host = process.env.TRIO_RCON_HOST?.trim();
  const port = process.env.TRIO_RCON_PORT?.trim();
  const password = process.env.TRIO_RCON_PASSWORD;
  if (!host || !port || !password) return null;
  const url = `ws://${host}:${port}/${password}`;
  if (trioSocket && connectionUrl !== url) disconnect(trioSocket);
  if (trioSocket?.readyState === WebSocket.OPEN) return trioSocket;
  if (trioConnecting) return trioConnecting;
  connectionUrl = url;
  trioConnecting = new Promise<WebSocket | null>(resolve => {
    let socket: WebSocket;
    try { socket = new WebSocket(url, { handshakeTimeout: 12000 }); }
    catch { resolve(null); return; }
    trioSocket = socket;
    let settled = false;
    const finish = (value: WebSocket | null) => {
      if (settled) return;
      settled = true; clearTimeout(timer); resolve(value);
    };
    const timer = setTimeout(() => { finish(null); disconnect(socket); }, 12000);
    socket.on("open", () => finish(socket));
    socket.on("message", data => {
      if (trioSocket !== socket) return;
      try {
        const response = JSON.parse(String(data));
        if (typeof response.Message === "string") {
          pending.get(response.Identifier)?.finish(response.Message);
          for (const handler of trioEventHandlers) {
            try { handler(response.Type || "", response.Message); }
            catch (error) { logger.error({ error }, "Trio RCON event handler failed"); }
          }
        }
      } catch { /* Ignore broadcasts that are not RCON response JSON. */ }
    });
    socket.on("error", () => { finish(null); disconnect(socket); });
    socket.on("close", () => { finish(null); disconnect(socket); });
  }).finally(() => { trioConnecting = null; });
  return trioConnecting;
}

// Reuse one isolated Trio socket for status, slots, store and Booster commands.
// Never replay a mutation on failure: reconnect on the next request instead.
export async function executeServerRcon(server: GuerraFriaServerId, command: string): Promise<string | null> {
  if (server === "solo-duo") return executeDuoRconCommand(command);
  const socket = await connectTrio();
  if (!socket || socket.readyState !== WebSocket.OPEN) return null;
  const id = identifier++;
  return new Promise(resolve => {
    const finish = (value: string | null) => {
      if (!pending.delete(id)) return;
      clearTimeout(timer); resolve(value);
    };
    const timer = setTimeout(() => {
      logger.warn({ server: "trio", identifier: id }, "Trio RCON response timed out; reconnecting on next request");
      finish(null); disconnect(socket);
    }, 12000);
    pending.set(id, { finish });
    try {
      socket.send(JSON.stringify({ Identifier: id, Message: command, Name: "Guerra Fria Trio" }), error => {
        if (error) { finish(null); disconnect(socket); }
      });
    } catch { finish(null); disconnect(socket); }
  });
}

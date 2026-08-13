import { setRconEventHandler } from "../bot/utils/rcon.js";

export type LiveChatItem = { id: number; at: string; type: string; player: string; message: string; raw: string };
export type LiveEvent = { key: string; label: string; active: boolean; lastSeen: string | null; lastMessage: string | null };

let started = false;
let seq = 1;
const chat: LiveChatItem[] = [];
const events = new Map<string, LiveEvent>([
  ["cargo", { key: "cargo", label: "Cargo Ship", active: false, lastSeen: null, lastMessage: null }],
  ["heli", { key: "heli", label: "Patrol Helicopter", active: false, lastSeen: null, lastMessage: null }],
  ["chinook", { key: "chinook", label: "CH47 Chinook", active: false, lastSeen: null, lastMessage: null }],
  ["bradley", { key: "bradley", label: "Bradley APC", active: false, lastSeen: null, lastMessage: null }],
  ["plane", { key: "plane", label: "Cargo Plane", active: false, lastSeen: null, lastMessage: null }],
]);

function trimList<T>(arr: T[], max: number) { if (arr.length > max) arr.splice(0, arr.length - max); }

function parseChat(raw: string): { player: string; message: string } | null {
  const text = raw.trim();
  // Common Rust WebRCON chat JSON shape.
  try {
    const j = JSON.parse(text) as Record<string, unknown>;
    const msg = String(j.Message ?? j.message ?? j.Text ?? j.text ?? "").trim();
    const player = String(j.Username ?? j.username ?? j.DisplayName ?? j.name ?? j.UserId ?? "Jugador").trim();
    if (msg && (j.Channel !== undefined || j.UserId !== undefined || j.Username !== undefined)) return { player, message: msg };
  } catch {}
  const m = text.match(/^\[CHAT\]\s*(?:\[[^\]]+\]\s*)?([^:]{1,40}):\s*(.+)$/i);
  return m ? { player: m[1].trim(), message: m[2].trim() } : null;
}

function markEvent(key: string, raw: string) {
  const e = events.get(key); if (!e) return;
  e.active = true; e.lastSeen = new Date().toISOString(); e.lastMessage = raw.slice(0, 300);
  const lifetime = key === "cargo" ? 65 : key === "heli" ? 25 : key === "chinook" ? 25 : key === "plane" ? 10 : 45;
  setTimeout(() => { const current = events.get(key); if (current?.lastSeen === e.lastSeen) current.active = false; }, lifetime * 60_000);
}

function inspectEvent(raw: string) {
  const s = raw.toLowerCase();
  if (/cargo.?ship|cargoship/.test(s)) markEvent("cargo", raw);
  if (/patrol.?helicopter|patrolhelicopter/.test(s)) markEvent("heli", raw);
  if (/chinook|ch47/.test(s)) markEvent("chinook", raw);
  if (/bradley/.test(s)) markEvent("bradley", raw);
  if (/cargo.?plane|cargoplane/.test(s)) markEvent("plane", raw);
}

export function initLiveOps(): void {
  if (started) return; started = true;
  setRconEventHandler((type, raw) => {
    inspectEvent(raw);
    const parsed = parseChat(raw);
    if (parsed) {
      chat.push({ id: seq++, at: new Date().toISOString(), type: type || "chat", player: parsed.player, message: parsed.message, raw: raw.slice(0, 1000) });
      trimList(chat, 250);
    }
  });
}

export function getLiveChat(): LiveChatItem[] { return chat.slice(-150); }
export function addModeratorChat(player: string, message: string): void {
  chat.push({ id: seq++, at: new Date().toISOString(), type: "moderation", player, message, raw: message });
  trimList(chat, 250);
}
export function getLiveEvents(): LiveEvent[] { return Array.from(events.values()); }

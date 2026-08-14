import { setRconEventHandler } from "../bot/utils/rcon.js";

export type LiveChatItem = { id: number; at: string; type: string; player: string; message: string; raw: string };
export type LiveEvent = { key: string; label: string; active: boolean; lastSeen: string | null; lastMessage: string | null; nextEstimate: string | null; averageIntervalMinutes: number | null; detections: number };

let started = false;
let seq = 1;
const chat: LiveChatItem[] = [];
const history = new Map<string, number[]>();
const events = new Map<string, LiveEvent>([
  ["cargo", { key: "cargo", label: "Cargo Ship", active: false, lastSeen: null, lastMessage: null, nextEstimate: null, averageIntervalMinutes: null, detections: 0 }],
  ["heli", { key: "heli", label: "Helicóptero de Patrulha", active: false, lastSeen: null, lastMessage: null, nextEstimate: null, averageIntervalMinutes: null, detections: 0 }],
  ["chinook", { key: "chinook", label: "CH47 Chinook", active: false, lastSeen: null, lastMessage: null, nextEstimate: null, averageIntervalMinutes: null, detections: 0 }],
  ["bradley", { key: "bradley", label: "Bradley APC", active: false, lastSeen: null, lastMessage: null, nextEstimate: null, averageIntervalMinutes: null, detections: 0 }],
  ["plane", { key: "plane", label: "Avião de Carga", active: false, lastSeen: null, lastMessage: null, nextEstimate: null, averageIntervalMinutes: null, detections: 0 }],
]);

function trimList<T>(arr: T[], max: number) { if (arr.length > max) arr.splice(0, arr.length - max); }

function isPluginTelemetry(text: string): boolean {
  const s = text.trim().toLowerCase();
  if (!s) return true;
  if (s.includes("[gf_leaderboard]")) return true;
  if (s.includes("[guerrafrialeaderboard]")) return true;
  if ((s.includes("leaderboard") || s.includes("plugin")) && (s.includes("\"event\"") || s.includes("\"timestamp\""))) return true;
  return false;
}

function parseChat(raw: string): { player: string; message: string } | null {
  const text = raw.trim();
  if (isPluginTelemetry(text)) return null;

  try {
    const parsed = JSON.parse(text) as unknown;
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const j = row as Record<string, unknown>;
      const msg = String(j.Message ?? j.message ?? j.Text ?? j.text ?? j.Content ?? j.content ?? "").trim();
      const player = String(j.Username ?? j.username ?? j.DisplayName ?? j.displayName ?? j.Name ?? j.name ?? j.UserId ?? j.userId ?? "Jogador").trim();
      const channel = j.Channel ?? j.channel ?? j.ChatChannel ?? j.chatChannel;
      if (msg && (channel !== undefined || j.UserId !== undefined || j.userId !== undefined || j.Username !== undefined || j.username !== undefined || j.DisplayName !== undefined)) {
        return { player: player || "Jogador", message: msg };
      }
    }
  } catch {}

  const chatPrefix = text.match(/^\[CHAT\]\s*(?:\[[^\]]+\]\s*)?([^:]{1,60}):\s*(.+)$/i);
  if (chatPrefix && chatPrefix[1] && chatPrefix[2] && !/^server$/i.test(chatPrefix[1].trim())) {
    return { player: chatPrefix[1].trim(), message: chatPrefix[2].trim() };
  }
  return null;
}

function recalcPrediction(key: string) {
  const e = events.get(key); if (!e) return;
  const h = history.get(key) ?? [];
  e.detections = h.length;
  if (h.length < 2) { e.averageIntervalMinutes = null; e.nextEstimate = null; return; }
  const intervals: number[] = [];
  for (let i = 1; i < h.length; i++) intervals.push(h[i] - h[i - 1]);
  const recent = intervals.slice(-6);
  const avgMs = recent.reduce((a, b) => a + b, 0) / recent.length;
  e.averageIntervalMinutes = Math.round(avgMs / 60000);
  e.nextEstimate = new Date(h[h.length - 1] + avgMs).toISOString();
}

function markEvent(key: string, raw: string) {
  const e = events.get(key); if (!e) return;
  const now = Date.now();
  const h = history.get(key) ?? [];
  const last = h[h.length - 1] ?? 0;
  if (!last || now - last > 2 * 60_000) {
    h.push(now); trimList(h, 12); history.set(key, h); recalcPrediction(key);
  }
  e.active = true; e.lastSeen = new Date(now).toISOString(); e.lastMessage = raw.slice(0, 300);
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

import { setRconEventHandler } from "../bot/utils/rcon.js";
import { notifySubscribedAdmins, pushAdminAlert } from "./adminNotifications.js";

export type LiveChatItem = { id: number; at: string; type: string; player: string; message: string; raw: string };
export type LiveEvent = { key: string; label: string; active: boolean; lastSeen: string | null; lastMessage: string | null; nextEstimate: string | null; averageIntervalMinutes: number | null; detections: number };

type AntiBotEvent = {
  eventType?: string;
  timestamp?: string;
  ip?: string | null;
  reason?: string;
  durationSeconds?: number;
  strike?: number;
  attackMode?: boolean;
  emergencyMode?: boolean;
  attemptsPerSecond?: number;
  attemptsInWindow?: number;
  uniqueIpsLastMinute?: number;
  blockedIps?: number;
};

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

const recentChat = new Map<string, number>();

function normalizePlayer(player: string): string {
  return player
    .replace(/\[7656119\d{10}\]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizeMessage(message: string): string {
  return message.replace(/\s+/g, " ").trim().toLowerCase();
}

function shouldIgnoreChat(player: string, message: string): boolean {
  const normalizedPlayer = normalizePlayer(player);
  if (!normalizedPlayer || normalizedPlayer === "server") return true;

  const key = `${normalizedPlayer}:${normalizeMessage(message)}`;
  const now = Date.now();
  const lastSeen = recentChat.get(key);
  recentChat.set(key, now);

  for (const [savedKey, timestamp] of recentChat) {
    if (now - timestamp > 15_000) recentChat.delete(savedKey);
  }

  return lastSeen !== undefined && now - lastSeen < 5_000;
}

function isPluginTelemetry(text: string): boolean {
  const s = text.trim().toLowerCase();
  if (!s) return true;
  if (s.includes("[gf_leaderboard]")) return true;
  if (s.includes("[guerrafrialeaderboard]")) return true;
  if (s.includes("[gf_antibot]")) return true;
  if (s.includes("[gf_antibot_event]")) return true;
  if ((s.includes("leaderboard") || s.includes("plugin")) && (s.includes("\"event\"") || s.includes("\"timestamp\""))) return true;
  return false;
}

function parseAntiBotEvent(raw: string): AntiBotEvent | null {
  const prefix = "[GF_ANTIBOT_EVENT]";
  const index = raw.indexOf(prefix);
  if (index < 0) return null;
  const text = raw.slice(index + prefix.length).trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  try { return JSON.parse(text.slice(start, end + 1)) as AntiBotEvent; }
  catch { return null; }
}

function registerAntiBotEvent(event: AntiBotEvent): void {
  const kind = String(event.eventType || "").toLowerCase();
  const ip = event.ip ? String(event.ip) : null;
  const reason = String(event.reason || "Sem motivo informado");
  const duration = Math.max(0, Number(event.durationSeconds) || 0);
  const strike = Math.max(0, Number(event.strike) || 0);
  const rate = Math.max(0, Number(event.attemptsPerSecond) || 0);
  const unique = Math.max(0, Number(event.uniqueIpsLastMinute) || 0);

  if (kind === "block") {
    const details = [
      ip ? `IP: ${ip}` : null,
      `Motivo: ${reason}`,
      duration ? `Bloqueio: ${duration}s` : null,
      strike ? `Reincidência: ${strike}` : null,
      `Conexões/s no momento: ${rate}`,
      `IPs únicos/min: ${unique}`,
    ].filter(Boolean).join(" • ");

    pushAdminAlert({
      kind: "system",
      title: "🛡️ Anti-Bot interceptou uma conexão",
      message: details,
      severity: "warning",
    });
    return;
  }

  if (kind === "plugin_loaded") {
    pushAdminAlert({
      kind: "system",
      title: "🟢 GuerraFriaAntiBot ativado",
      message: `${reason}. A telemetria e os registros de interceptação estão conectados ao painel.`,
      severity: "success",
    });
    return;
  }

  // Ataque normal já gera alerta pela telemetria em routesServer.ts.
  // Emergência é um nível extra do v1.2.x e precisa de notificação própria.
  if (kind === "emergency_on") {
    void notifySubscribedAdmins({
      kind: "system",
      title: "🚨 Anti-Bot em MODO EMERGÊNCIA",
      message: `${reason}. Conexões novas desconhecidas estão sob filtragem máxima. ${rate} conexões/s • ${unique} IPs únicos/min.`,
      severity: "critical",
    }).catch(() => {});
    return;
  }

  if (kind === "emergency_off") {
    void notifySubscribedAdmins({
      kind: "system",
      title: "✅ Modo emergência L7 encerrado",
      message: `${reason}. O Anti-Bot voltou à filtragem normal.`,
      severity: "success",
    }).catch(() => {});
  }
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
    const antiBotEvent = parseAntiBotEvent(raw);
    if (antiBotEvent) registerAntiBotEvent(antiBotEvent);

    inspectEvent(raw);
    const parsed = parseChat(raw);
    if (parsed && !shouldIgnoreChat(parsed.player, parsed.message)) {
      chat.push({ id: seq++, at: new Date().toISOString(), type: type || "chat", player: parsed.player.replace(/\[7656119\d{10}\]/g, "").trim(), message: parsed.message, raw: raw.slice(0, 1000) });
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

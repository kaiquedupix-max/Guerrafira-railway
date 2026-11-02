import { db, modLogsTable } from "@workspace/db";
import { getPlayerBySteamId } from "../bot/utils/players.js";
import { adminServer } from "./adminServerContext.js";
import { ensureIpModeration, resetModerationReadiness } from "./ipModeration.js";
import { executeRconRequired, type ActionActor } from "./systemActions.js";
import { setRustChatMute } from "./rustMute.js";
import { ActionError } from "./actionError.js";

export const muteDurations = [
  { name: "10 minutos", value: "10m", ms: 10 * 60_000 },
  { name: "30 minutos", value: "30m", ms: 30 * 60_000 },
  { name: "1 hora", value: "1h", ms: 60 * 60_000 },
  { name: "2 horas", value: "2h", ms: 2 * 60 * 60_000 },
  { name: "6 horas", value: "6h", ms: 6 * 60 * 60_000 },
  { name: "12 horas", value: "12h", ms: 12 * 60 * 60_000 },
  { name: "1 dia", value: "1d", ms: 24 * 60 * 60_000 },
  { name: "3 dias", value: "3d", ms: 3 * 24 * 60 * 60_000 },
  { name: "7 dias", value: "7d", ms: 7 * 24 * 60 * 60_000 },
] as const;
const locks = new Map<string, Promise<unknown>>();
export async function withMuteLock<T>(steamId: string, run: () => Promise<T>): Promise<T> {
  const key = `${adminServer()}:${steamId}`;
  const next = (locks.get(key) || Promise.resolve()).catch(() => {}).then(run);
  locks.set(key, next);
  try { return await next; } finally { if (locks.get(key) === next) locks.delete(key); }
}
export async function applyChatMute(steamId: string, expiresAt: Date | null): Promise<void> {
  await ensureIpModeration();
  try { await setRustChatMute(steamId, expiresAt, executeRconRequired); }
  catch (error) { resetModerationReadiness(); throw error; }
}
export async function moderateChat(input: { steamId: string; duration?: string; reason?: string; actor: ActionActor; muted: boolean }) {
  if (!/^7656119\d{10}$/.test(input.steamId)) throw new ActionError("SteamID inválido.");
  const duration = muteDurations.find(d => d.value === input.duration);
  const reason = String(input.reason || (input.muted ? "" : "Mute removido pela administração")).replace(/[\r\n\t"]/g, " ").trim().slice(0, 300);
  if (input.muted && !duration) throw new ActionError("Tempo de mute inválido.");
  if (!reason) throw new ActionError("Motivo obrigatório.");
  return withMuteLock(input.steamId, async () => {
    const player = await getPlayerBySteamId(input.steamId);
    const playerName = player?.playerName || `Jogador (${input.steamId})`;
    const expiresAt = input.muted ? new Date(Date.now() + duration!.ms) : null;
    await applyChatMute(input.steamId, expiresAt);
    await db.insert(modLogsTable).values({ serverId: adminServer(), action: input.muted ? "MUTE" : "UNMUTE", steamId: input.steamId, playerName, reason, adminId: input.actor.id, adminName: input.actor.name, banDuration: input.muted ? duration!.value : null, banExpiresAt: expiresAt, publicVisible: false });
    return { playerName, expiresAt, durationLabel: duration?.name };
  });
}

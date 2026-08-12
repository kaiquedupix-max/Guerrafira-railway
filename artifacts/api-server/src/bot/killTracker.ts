/**
 * Guerra Fria leaderboard tracker + anti-cheat event bridge.
 */

import { db, playerStatsTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { analyzeKill } from "./antiCheat.js";

function extractJson(message: string): Record<string, unknown> | null {
  const start = message.indexOf("{");
  const end = message.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  try {
    const parsed = JSON.parse(message.slice(start, end + 1));
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function eventName(obj: Record<string, unknown>): string {
  const raw = obj.event ?? obj.type ?? obj.event_type;
  return typeof raw === "string" ? raw.toLowerCase() : "";
}

async function recordKill(opts: {
  killerSteamId: string;
  killerName: string;
  victimSteamId: string;
  victimName: string;
  headshot: boolean;
}): Promise<void> {
  const { killerSteamId, killerName, victimSteamId, victimName, headshot } = opts;
  await Promise.all([
    db.insert(playerStatsTable).values({ steamId: killerSteamId, playerName: killerName, kills: 1, headshots: headshot ? 1 : 0 }).onConflictDoUpdate({
      target: playerStatsTable.steamId,
      set: { playerName: killerName, kills: sql`${playerStatsTable.kills} + 1`, headshots: sql`${playerStatsTable.headshots} + ${headshot ? 1 : 0}`, updatedAt: sql`now()` },
    }),
    db.insert(playerStatsTable).values({ steamId: victimSteamId, playerName: victimName, deaths: 1 }).onConflictDoUpdate({
      target: playerStatsTable.steamId,
      set: { playerName: victimName, deaths: sql`${playerStatsTable.deaths} + 1`, updatedAt: sql`now()` },
    }),
  ]);
}

interface KillPayloadA {
  event?: string;
  attacker?: string;
  attacker_steamid?: string;
  victim?: string;
  victim_steamid?: string;
  bodypart?: string;
  headshot?: boolean;
  weapon?: string;
  distance?: number;
  timestamp?: number;
}

interface KillPayloadB {
  event?: string;
  killer?: string;
  killer_id?: string;
  victim?: string;
  victim_id?: string;
  headshot?: boolean;
  is_headshot?: boolean;
  weapon?: string;
  distance?: number;
  timestamp?: number;
}

export function parseKillEvent(type: string, message: string): boolean {
  const obj = extractJson(message) as (KillPayloadA & KillPayloadB & Record<string, unknown>) | null;
  if (!obj) return false;

  const ev = eventName(obj);
  const lowerType = type.toLowerCase();
  const looksLikeKill = ev === "kill" || lowerType.includes("kill") || lowerType.includes("death") || lowerType.includes("combat") || lowerType === "generic" || type === "";
  if (!looksLikeKill) return false;

  if (obj.attacker_steamid && obj.victim_steamid) {
    const headshot = obj.headshot === true || (typeof obj.bodypart === "string" && (obj.bodypart.toLowerCase().includes("head") || obj.bodypart.toLowerCase() === "skull"));
    const payload = {
      killerSteamId: obj.attacker_steamid,
      killerName: obj.attacker ?? "Unknown",
      victimSteamId: obj.victim_steamid,
      victimName: obj.victim ?? "Unknown",
      headshot,
    };
    recordKill(payload)
      .then(() => analyzeKill({
        attackerSteamId: payload.killerSteamId,
        attackerName: payload.killerName,
        victimSteamId: payload.victimSteamId,
        victimName: payload.victimName,
        headshot,
        weapon: typeof obj.weapon === "string" ? obj.weapon : undefined,
        distance: Number.isFinite(Number(obj.distance)) ? Number(obj.distance) : undefined,
        timestamp: Number.isFinite(Number(obj.timestamp)) ? Number(obj.timestamp) : undefined,
      }))
      .catch((err) => logger.error({ err }, "recordKill/antiCheat error"));
    return true;
  }

  if (obj.killer_id && obj.victim_id) {
    const headshot = obj.headshot === true || obj.is_headshot === true;
    const payload = {
      killerSteamId: obj.killer_id,
      killerName: obj.killer ?? "Unknown",
      victimSteamId: obj.victim_id,
      victimName: obj.victim ?? "Unknown",
      headshot,
    };
    recordKill(payload)
      .then(() => analyzeKill({
        attackerSteamId: payload.killerSteamId,
        attackerName: payload.killerName,
        victimSteamId: payload.victimSteamId,
        victimName: payload.victimName,
        headshot,
        weapon: typeof obj.weapon === "string" ? obj.weapon : undefined,
        distance: Number.isFinite(Number(obj.distance)) ? Number(obj.distance) : undefined,
        timestamp: Number.isFinite(Number(obj.timestamp)) ? Number(obj.timestamp) : undefined,
      }))
      .catch((err) => logger.error({ err }, "recordKill/antiCheat error"));
    return true;
  }

  return false;
}

interface GatherPayload extends Record<string, unknown> { event?: string; steamid?: string; player?: string; item?: string; amount?: number; }
interface CraftPayload extends Record<string, unknown> { event?: string; steamid?: string; player?: string; item?: string; amount?: number; }

export function parseGatherEvent(type: string, message: string): boolean {
  const obj = extractJson(message) as GatherPayload | null;
  if (!obj?.steamid) return false;
  const ev = eventName(obj);
  const lowerType = type.toLowerCase();
  if (ev !== "gather" && !lowerType.includes("gather") && !lowerType.includes("resource")) return false;
  const amount = Number.isFinite(Number(obj.amount)) ? Math.max(0, Math.floor(Number(obj.amount))) : 0;
  if (amount <= 0) return false;
  db.insert(playerStatsTable).values({ steamId: obj.steamid, playerName: obj.player ?? "Unknown", resourcesGathered: amount }).onConflictDoUpdate({
    target: playerStatsTable.steamId,
    set: { playerName: obj.player ?? "Unknown", resourcesGathered: sql`${playerStatsTable.resourcesGathered} + ${amount}`, updatedAt: sql`now()` },
  }).catch((err) => logger.error({ err }, "recordGather error"));
  return true;
}

const EXPLOSIVE_SHORTNAMES = new Set(["explosives", "explosive.timed", "grenade.f1", "grenade.beancan", "ammo.rocket.basic", "ammo.rocket.hv", "ammo.rocket.fire", "ammo.rifle.explosive", "surveycharge"]);

export function parseCraftEvent(type: string, message: string): boolean {
  const obj = extractJson(message) as CraftPayload | null;
  if (!obj?.steamid) return false;
  const ev = eventName(obj);
  const lowerType = type.toLowerCase();
  if (ev !== "craft" && !lowerType.includes("craft")) return false;
  if (typeof obj.item === "string" && !EXPLOSIVE_SHORTNAMES.has(obj.item.toLowerCase())) return false;
  const amount = Number.isFinite(Number(obj.amount)) ? Math.max(0, Math.floor(Number(obj.amount))) : 0;
  if (amount <= 0) return false;
  db.insert(playerStatsTable).values({ steamId: obj.steamid, playerName: obj.player ?? "Unknown", explosivesCrafted: amount }).onConflictDoUpdate({
    target: playerStatsTable.steamId,
    set: { playerName: obj.player ?? "Unknown", explosivesCrafted: sql`${playerStatsTable.explosivesCrafted} + ${amount}`, updatedAt: sql`now()` },
  }).catch((err) => logger.error({ err }, "recordCraft error"));
  return true;
}

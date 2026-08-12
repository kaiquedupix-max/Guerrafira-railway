/**
 * Kill / death / headshot tracker via RCON broadcast events.
 *
 * Rust servers with Statistics or Leaderboard plugins emit kill events as JSON
 * broadcasts. Without a plugin, raw game output contains death messages.
 * This module handles both formats and upserts into player_stats.
 *
 * Supported plugin JSON formats:
 *   {"attacker":"Name","attacker_steamid":"76561...","victim":"Name","victim_steamid":"76561...","weapon":"...","bodypart":"head"}
 *   {"killer_id":"76561...","killer":"Name","victim_id":"76561...","victim":"Name","headshot":true,"weapon":"..."}
 */

import { db, playerStatsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";

// ─── Upsert helpers ──────────────────────────────────────────────────────────
async function recordKill(opts: {
  killerSteamId: string;
  killerName:    string;
  victimSteamId: string;
  victimName:    string;
  headshot:      boolean;
}): Promise<void> {
  const { killerSteamId, killerName, victimSteamId, victimName, headshot } = opts;

  await Promise.all([
    // Attacker gets kill (+ headshot if applicable)
    db
      .insert(playerStatsTable)
      .values({
        steamId:    killerSteamId,
        playerName: killerName,
        kills:      1,
        headshots:  headshot ? 1 : 0,
      })
      .onConflictDoUpdate({
        target: playerStatsTable.steamId,
        set: {
          playerName: killerName,
          kills:      sql`${playerStatsTable.kills} + 1`,
          headshots:  sql`${playerStatsTable.headshots} + ${headshot ? 1 : 0}`,
          updatedAt:  sql`now()`,
        },
      }),

    // Victim gets a death
    db
      .insert(playerStatsTable)
      .values({
        steamId:    victimSteamId,
        playerName: victimName,
        deaths:     1,
      })
      .onConflictDoUpdate({
        target: playerStatsTable.steamId,
        set: {
          playerName: victimName,
          deaths:     sql`${playerStatsTable.deaths} + 1`,
          updatedAt:  sql`now()`,
        },
      }),
  ]);
}

// ─── Format 1: Statistics / Leaderboard plugin ────────────────────────────────
interface KillPayloadA {
  attacker?: string;
  attacker_steamid?: string;
  victim?: string;
  victim_steamid?: string;
  bodypart?: string;
  headshot?: boolean;
}

interface KillPayloadB {
  killer?: string;
  killer_id?: string;
  victim?: string;
  victim_id?: string;
  headshot?: boolean;
  is_headshot?: boolean;
}

export function parseKillEvent(type: string, message: string): boolean {
  // Only act on types that look like kill events
  const lowerType = type.toLowerCase();
  const isKillType =
    lowerType.includes("kill") ||
    lowerType.includes("death") ||
    lowerType.includes("combat") ||
    lowerType === "generic"; // some plugins use generic

  if (!isKillType && type !== "") return false;

  // Try JSON parse
  try {
    const obj = JSON.parse(message) as KillPayloadA & KillPayloadB;

    // Format A: attacker_steamid / victim_steamid
    if (obj.attacker_steamid && obj.victim_steamid) {
      const headshot =
        obj.headshot === true ||
        (typeof obj.bodypart === "string" &&
          (obj.bodypart.toLowerCase().includes("head") || obj.bodypart === "skull"));
      recordKill({
        killerSteamId: obj.attacker_steamid,
        killerName:    obj.attacker ?? "Unknown",
        victimSteamId: obj.victim_steamid,
        victimName:    obj.victim ?? "Unknown",
        headshot,
      }).catch((err) => logger.error({ err }, "recordKill error"));
      return true;
    }

    // Format B: killer_id / victim_id
    if (obj.killer_id && obj.victim_id) {
      const headshot = obj.headshot === true || obj.is_headshot === true;
      recordKill({
        killerSteamId: obj.killer_id,
        killerName:    obj.killer ?? "Unknown",
        victimSteamId: obj.victim_id,
        victimName:    obj.victim ?? "Unknown",
        headshot,
      }).catch((err) => logger.error({ err }, "recordKill error"));
      return true;
    }
  } catch {
    // Not JSON — ignore; without a plugin kill events aren't reliable text
  }

  return false;
}

// ─── Resource / craft tracking (requires plugin) ─────────────────────────────
interface GatherPayload { steamid?: string; player?: string; amount?: number }
interface CraftPayload  { steamid?: string; player?: string; item?: string; amount?: number }

export function parseGatherEvent(type: string, message: string): boolean {
  if (!type.toLowerCase().includes("gather") && !type.toLowerCase().includes("resource")) return false;
  try {
    const obj = JSON.parse(message) as GatherPayload;
    if (!obj.steamid) return false;
    const amount = obj.amount ?? 1;
    db
      .insert(playerStatsTable)
      .values({ steamId: obj.steamid, playerName: obj.player ?? "Unknown", resourcesGathered: amount })
      .onConflictDoUpdate({
        target: playerStatsTable.steamId,
        set: {
          playerName:        obj.player ?? "Unknown",
          resourcesGathered: sql`${playerStatsTable.resourcesGathered} + ${amount}`,
          updatedAt:         sql`now()`,
        },
      })
      .catch((err) => logger.error({ err }, "recordGather error"));
    return true;
  } catch { return false; }
}

export function parseCraftEvent(type: string, message: string): boolean {
  if (!type.toLowerCase().includes("craft")) return false;
  try {
    const obj = JSON.parse(message) as CraftPayload;
    if (!obj.steamid) return false;
    const isExplosive =
      typeof obj.item === "string" &&
      (obj.item.includes("explosive") || obj.item.includes("c4") || obj.item.includes("rocket") || obj.item.includes("grenade"));
    if (!isExplosive) return false;
    const amount = obj.amount ?? 1;
    db
      .insert(playerStatsTable)
      .values({ steamId: obj.steamid, playerName: obj.player ?? "Unknown", explosivesCrafted: amount })
      .onConflictDoUpdate({
        target: playerStatsTable.steamId,
        set: {
          playerName:       obj.player ?? "Unknown",
          explosivesCrafted: sql`${playerStatsTable.explosivesCrafted} + ${amount}`,
          updatedAt:        sql`now()`,
        },
      })
      .catch((err) => logger.error({ err }, "recordCraft error"));
    return true;
  } catch { return false; }
}

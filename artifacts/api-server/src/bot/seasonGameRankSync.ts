import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { executeRconCommand } from "./utils/rcon.js";

const OFFICIAL_KEY = 101;
const STARTING_MMR = 1000;
const GROUPS = [
  "season_recruta",
  "season_soldado",
  "season_tenente",
  "season_major",
  "season_marechal",
  "season_generalfrio",
] as const;
type SeasonGroup = typeof GROUPS[number];

let timer: NodeJS.Timeout | null = null;
let running = false;

async function ensureStateTable() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS season_game_rank_state (
      steam_id TEXT PRIMARY KEY,
      season_key INTEGER NOT NULL DEFAULT 101,
      current_group TEXT,
      active BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

function xpFromMmr(value: unknown): number {
  const mmr = Number(value);
  return Math.max(0, Math.round(((Number.isFinite(mmr) ? mmr : STARTING_MMR) - STARTING_MMR) * 9));
}

function groupFor(hasActivity: boolean, effectiveMmr: unknown, position: unknown): SeasonGroup {
  if (!hasActivity) return "season_recruta";
  const xp = xpFromMmr(effectiveMmr);
  const pos = Math.trunc(Number(position) || 0);
  if (pos === 1 && xp >= 1800) return "season_generalfrio";
  if (xp >= 1800) return "season_marechal";
  if (xp >= 1200) return "season_major";
  if (xp >= 600) return "season_tenente";
  return "season_soldado";
}

function validSteam(v: unknown): boolean {
  return /^7656119\d{10}$/.test(String(v || ""));
}

async function trackedPlayers() {
  await ensureStateTable();
  const result: any = await db.execute(sql`
    WITH source_season AS (
      SELECT COALESCE((
        SELECT p.season_number
        FROM season_players p
        LEFT JOIN seasons s ON s.season_number=p.season_number
        GROUP BY p.season_number
        ORDER BY CASE WHEN MAX(s.status)='active' THEN 0 ELSE 1 END,
                 MAX(p.updated_at) DESC NULLS LAST,
                 p.season_number DESC
        LIMIT 1
      ),1) AS season_number
    ),
    sd AS (
      SELECT p.steam_id,p.mmr,p.kills,p.updated_at
      FROM season_players p, source_season sn
      WHERE p.season_number=sn.season_number
    ),
    adjustments AS (
      SELECT t.steam_id,COALESCE(SUM(t.final_value),0) delta
      FROM season_transactions t, source_season sn
      WHERE t.season_number=sn.season_number AND t.category='admin'
      GROUP BY t.steam_id
    ),
    ranked AS (
      SELECT sd.steam_id,sd.mmr+COALESCE(a.delta,0) effective_mmr,
             ROW_NUMBER() OVER(ORDER BY sd.mmr+COALESCE(a.delta,0) DESC,sd.kills DESC,sd.updated_at ASC NULLS LAST) position
      FROM sd
      LEFT JOIN adjustments a ON a.steam_id=sd.steam_id
    ),
    registration_rows AS (
      SELECT r.steam_id,r.status,
             (sd.steam_id IS NOT NULL) has_activity,
             COALESCE(rank.effective_mmr,${STARTING_MMR}) effective_mmr,
             COALESCE(rank.position,0) position
      FROM season_official_registrations r
      LEFT JOIN sd ON sd.steam_id=r.steam_id
      LEFT JOIN ranked rank ON rank.steam_id=r.steam_id
      WHERE r.season_key=${OFFICIAL_KEY}
    )
    SELECT COALESCE(r.steam_id,s.steam_id) steam_id,
           COALESCE(r.status,'removed') status,
           COALESCE(r.has_activity,FALSE) has_activity,
           COALESCE(r.effective_mmr,${STARTING_MMR}) effective_mmr,
           COALESCE(r.position,0) position,
           s.current_group,s.active state_active
    FROM registration_rows r
    FULL OUTER JOIN season_game_rank_state s ON s.steam_id=r.steam_id
    WHERE COALESCE(s.season_key,${OFFICIAL_KEY})=${OFFICIAL_KEY}
  `);
  return Array.isArray(result?.rows) ? result.rows : [];
}

async function cmd(command: string): Promise<boolean> {
  const reply = await executeRconCommand(command);
  if (reply === null) {
    logger.warn({ command: command.replace(/7656119\d{10}/g, "STEAMID") }, "Season Rust group command failed");
    return false;
  }
  return true;
}

async function removeGroup(steamId: string, group: string) {
  return cmd(`chat user remove ${steamId} ${group}`);
}

async function addGroup(steamId: string, group: string) {
  return cmd(`chat user add ${steamId} ${group}`);
}

async function normalizeFirstTime(steamId: string, desired: SeasonGroup | null): Promise<boolean> {
  for (const group of GROUPS) {
    if (!(await removeGroup(steamId, group))) return false;
  }
  return desired ? addGroup(steamId, desired) : true;
}

async function saveState(steamId: string, group: SeasonGroup | null, active: boolean) {
  await db.execute(sql`
    INSERT INTO season_game_rank_state(steam_id,season_key,current_group,active,updated_at)
    VALUES(${steamId},${OFFICIAL_KEY},${group},${active},now())
    ON CONFLICT(steam_id) DO UPDATE SET
      season_key=EXCLUDED.season_key,current_group=EXCLUDED.current_group,
      active=EXCLUDED.active,updated_at=now()
  `);
}

export async function syncSeasonGameRanksOnce(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const rows = await trackedPlayers();
    let changed = 0;
    let cleared = 0;
    let failed = 0;

    for (const row of rows) {
      const steamId = String(row.steam_id || "").trim();
      if (!validSteam(steamId)) continue;
      const active = String(row.status || "").toLowerCase() === "active";
      const previous = GROUPS.includes(String(row.current_group || "") as SeasonGroup)
        ? String(row.current_group) as SeasonGroup
        : null;
      const hasState = row.state_active !== null && row.state_active !== undefined;
      const desired = active ? groupFor(Boolean(row.has_activity), row.effective_mmr, row.position) : null;

      if (!hasState) {
        const ok = await normalizeFirstTime(steamId, desired);
        if (!ok) { failed++; continue; }
        await saveState(steamId, desired, active);
        if (desired) changed++; else cleared++;
        continue;
      }

      if (!active) {
        if (previous) {
          if (!(await removeGroup(steamId, previous))) { failed++; continue; }
          cleared++;
        }
        await saveState(steamId, null, false);
        continue;
      }

      if (previous === desired && Boolean(row.state_active)) continue;
      if (previous && previous !== desired) {
        if (!(await removeGroup(steamId, previous))) { failed++; continue; }
      }
      if (!(await addGroup(steamId, desired))) { failed++; continue; }
      await saveState(steamId, desired, true);
      changed++;
    }

    if (changed || cleared || failed) {
      logger.info({ tracked: rows.length, changed, cleared, failed }, "Season Rust group sync completed");
    }
  } catch (error) {
    logger.error({ error }, "Season Rust group sync failed");
  } finally {
    running = false;
  }
}

export function startSeasonGameRankSync(): void {
  if (timer) return;
  void syncSeasonGameRanksOnce();
  timer = setInterval(() => void syncSeasonGameRanksOnce(), 60_000);
  timer.unref?.();
}

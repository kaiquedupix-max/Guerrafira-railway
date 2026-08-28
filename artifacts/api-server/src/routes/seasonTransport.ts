import { Router, type IRouter } from "express";
import { timingSafeEqual } from "node:crypto";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

function secretValue(): string {
  return String(process.env.SEASON_WEBHOOK_SECRET || process.env.LEADERBOARD_WEBHOOK_SECRET || "").trim();
}

function authorized(value: unknown): boolean {
  const expected = secretValue();
  const received = String(value || "").trim();
  if (!expected || !received) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
}

function n(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function i(value: unknown, fallback = 0): number {
  return Math.trunc(n(value, fallback));
}

function s(value: unknown, max = 1000): string {
  return String(value ?? "").slice(0, max);
}

async function ensureTables() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS seasons (
      season_number INTEGER PRIMARY KEY,
      season_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      starting_mmr DOUBLE PRECISION NOT NULL DEFAULT 1000,
      started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      ended_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS season_players (
      season_number INTEGER NOT NULL,
      season_id TEXT NOT NULL,
      steam_id TEXT NOT NULL,
      player_name TEXT NOT NULL,
      mmr DOUBLE PRECISION NOT NULL DEFAULT 1000,
      pvp_raid_mmr DOUBLE PRECISION NOT NULL DEFAULT 0,
      farm_mmr DOUBLE PRECISION NOT NULL DEFAULT 0,
      building_mmr DOUBLE PRECISION NOT NULL DEFAULT 0,
      event_mmr DOUBLE PRECISION NOT NULL DEFAULT 0,
      other_mmr DOUBLE PRECISION NOT NULL DEFAULT 0,
      kills INTEGER NOT NULL DEFAULT 0,
      deaths INTEGER NOT NULL DEFAULT 0,
      headshots INTEGER NOT NULL DEFAULT 0,
      assists INTEGER NOT NULL DEFAULT 0,
      wood BIGINT NOT NULL DEFAULT 0,
      stone BIGINT NOT NULL DEFAULT 0,
      metal_ore BIGINT NOT NULL DEFAULT 0,
      sulfur_ore BIGINT NOT NULL DEFAULT 0,
      hqm_ore BIGINT NOT NULL DEFAULT 0,
      build_wood INTEGER NOT NULL DEFAULT 0,
      build_stone INTEGER NOT NULL DEFAULT 0,
      build_metal INTEGER NOT NULL DEFAULT 0,
      build_armored INTEGER NOT NULL DEFAULT 0,
      rockets_used INTEGER NOT NULL DEFAULT 0,
      c4_used INTEGER NOT NULL DEFAULT 0,
      satchels_used INTEGER NOT NULL DEFAULT 0,
      raid_structures_destroyed INTEGER NOT NULL DEFAULT 0,
      tcs_destroyed INTEGER NOT NULL DEFAULT 0,
      raids_participated INTEGER NOT NULL DEFAULT 0,
      raids_defended INTEGER NOT NULL DEFAULT 0,
      bradley_participations INTEGER NOT NULL DEFAULT 0,
      heli_participations INTEGER NOT NULL DEFAULT 0,
      crates_hacked INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (season_number, steam_id)
    )
  `);
}

function cleanPlayer(p: Record<string, unknown>) {
  return {
    steam_id: s(p.steam_id || p.steamId, 32),
    player_name: s(p.player_name || p.playerName || p.steam_id || p.steamId, 128),
    mmr: n(p.mmr, 1000),
    pvp_raid_mmr: n(p.pvp_raid_mmr), farm_mmr: n(p.farm_mmr), building_mmr: n(p.building_mmr), event_mmr: n(p.event_mmr), other_mmr: n(p.other_mmr),
    kills: i(p.kills), deaths: i(p.deaths), headshots: i(p.headshots), assists: i(p.assists),
    wood: i(p.wood), stone: i(p.stone), metal_ore: i(p.metal_ore), sulfur_ore: i(p.sulfur_ore), hqm_ore: i(p.hqm_ore),
    build_wood: i(p.build_wood), build_stone: i(p.build_stone), build_metal: i(p.build_metal), build_armored: i(p.build_armored),
    rockets_used: i(p.rockets_used), c4_used: i(p.c4_used), satchels_used: i(p.satchels_used), raid_structures_destroyed: i(p.raid_structures_destroyed),
    tcs_destroyed: i(p.tcs_destroyed), raids_participated: i(p.raids_participated), raids_defended: i(p.raids_defended),
    bradley_participations: i(p.bradley_participations), heli_participations: i(p.heli_participations), crates_hacked: i(p.crates_hacked),
  };
}

async function bulkUpsertPlayers(seasonNumber: number, seasonId: string, rawPlayers: unknown[]) {
  const players = rawPlayers
    .filter((p): p is Record<string, unknown> => !!p && typeof p === "object")
    .map(cleanPlayer)
    .filter(p => /^7656119\d{10}$/.test(p.steam_id));

  if (!players.length) return 0;
  const payload = JSON.stringify(players);

  await db.execute(sql`
    WITH incoming AS (
      SELECT * FROM jsonb_to_recordset(${payload}::jsonb) AS x(
        steam_id text, player_name text, mmr double precision,
        pvp_raid_mmr double precision, farm_mmr double precision, building_mmr double precision, event_mmr double precision, other_mmr double precision,
        kills integer, deaths integer, headshots integer, assists integer,
        wood bigint, stone bigint, metal_ore bigint, sulfur_ore bigint, hqm_ore bigint,
        build_wood integer, build_stone integer, build_metal integer, build_armored integer,
        rockets_used integer, c4_used integer, satchels_used integer, raid_structures_destroyed integer,
        tcs_destroyed integer, raids_participated integer, raids_defended integer,
        bradley_participations integer, heli_participations integer, crates_hacked integer
      )
    )
    INSERT INTO season_players (
      season_number, season_id, steam_id, player_name, mmr,
      pvp_raid_mmr, farm_mmr, building_mmr, event_mmr, other_mmr,
      kills, deaths, headshots, assists,
      wood, stone, metal_ore, sulfur_ore, hqm_ore,
      build_wood, build_stone, build_metal, build_armored,
      rockets_used, c4_used, satchels_used, raid_structures_destroyed,
      tcs_destroyed, raids_participated, raids_defended,
      bradley_participations, heli_participations, crates_hacked, updated_at
    )
    SELECT
      ${seasonNumber}, ${seasonId}, steam_id, player_name, mmr,
      pvp_raid_mmr, farm_mmr, building_mmr, event_mmr, other_mmr,
      kills, deaths, headshots, assists,
      wood, stone, metal_ore, sulfur_ore, hqm_ore,
      build_wood, build_stone, build_metal, build_armored,
      rockets_used, c4_used, satchels_used, raid_structures_destroyed,
      tcs_destroyed, raids_participated, raids_defended,
      bradley_participations, heli_participations, crates_hacked, now()
    FROM incoming
    ON CONFLICT (season_number, steam_id) DO UPDATE SET
      season_id=EXCLUDED.season_id, player_name=EXCLUDED.player_name, mmr=EXCLUDED.mmr,
      pvp_raid_mmr=EXCLUDED.pvp_raid_mmr, farm_mmr=EXCLUDED.farm_mmr,
      building_mmr=EXCLUDED.building_mmr, event_mmr=EXCLUDED.event_mmr, other_mmr=EXCLUDED.other_mmr,
      kills=EXCLUDED.kills, deaths=EXCLUDED.deaths, headshots=EXCLUDED.headshots, assists=EXCLUDED.assists,
      wood=EXCLUDED.wood, stone=EXCLUDED.stone, metal_ore=EXCLUDED.metal_ore, sulfur_ore=EXCLUDED.sulfur_ore, hqm_ore=EXCLUDED.hqm_ore,
      build_wood=EXCLUDED.build_wood, build_stone=EXCLUDED.build_stone, build_metal=EXCLUDED.build_metal, build_armored=EXCLUDED.build_armored,
      rockets_used=EXCLUDED.rockets_used, c4_used=EXCLUDED.c4_used, satchels_used=EXCLUDED.satchels_used,
      raid_structures_destroyed=EXCLUDED.raid_structures_destroyed, tcs_destroyed=EXCLUDED.tcs_destroyed,
      raids_participated=EXCLUDED.raids_participated, raids_defended=EXCLUDED.raids_defended,
      bradley_participations=EXCLUDED.bradley_participations, heli_participations=EXCLUDED.heli_participations,
      crates_hacked=EXCLUDED.crates_hacked, updated_at=now()
  `);
  return players.length;
}

router.get("/season/ping", async (req, res) => {
  if (!authorized(req.header("x-gf-season-secret"))) return void res.status(401).json({ error: "Assinatura inválida." });
  try {
    await db.execute(sql`SELECT 1`);
    res.setHeader("Cache-Control", "no-store");
    return void res.status(200).json({ ok: true, service: "season", database: "ok", now: new Date().toISOString() });
  } catch (error) {
    logger.error({ error }, "season ping failed");
    return void res.status(503).json({ ok: false, database: "error" });
  }
});

router.get("/season/bootstrap", async (req, res) => {
  if (!authorized(req.header("x-gf-season-secret"))) return void res.status(401).json({ error: "Assinatura inválida." });
  try {
    await ensureTables();
    const requested = i(req.query.season_number);
    const seasonResult: any = requested > 0
      ? await db.execute(sql`SELECT * FROM seasons WHERE season_number=${requested} LIMIT 1`)
      : await db.execute(sql`SELECT * FROM seasons ORDER BY CASE WHEN status='active' THEN 0 ELSE 1 END, season_number DESC LIMIT 1`);
    const season = seasonResult?.rows?.[0] ?? null;
    if (!season) {
      res.setHeader("Cache-Control", "no-store");
      return void res.status(200).json({ ok: true, season: null, players: [] });
    }
    const playersResult: any = await db.execute(sql`SELECT * FROM season_players WHERE season_number=${i(season.season_number)} ORDER BY mmr DESC`);
    res.setHeader("Cache-Control", "no-store");
    return void res.status(200).json({ ok: true, season, players: playersResult?.rows ?? [] });
  } catch (error) {
    logger.error({ error }, "season bootstrap failed");
    return void res.status(500).json({ error: "Falha ao carregar estado da Season." });
  }
});

router.post("/season/snapshot-fast", async (req, res) => {
  if (!authorized(req.header("x-gf-season-secret"))) return void res.status(401).json({ error: "Assinatura inválida." });
  try {
    await ensureTables();
    const seasonNumber = i(req.body?.season_number);
    const seasonId = s(req.body?.season_id, 64);
    const startingMmr = n(req.body?.starting_mmr, 1000);
    const players = Array.isArray(req.body?.players) ? req.body.players.slice(0, 1000) : [];
    if (seasonNumber < 1 || !seasonId) return void res.status(400).json({ error: "Season inválida." });

    await db.execute(sql`
      INSERT INTO seasons (season_number, season_id, starting_mmr, status, updated_at)
      VALUES (${seasonNumber}, ${seasonId}, ${startingMmr}, 'active', now())
      ON CONFLICT (season_number) DO UPDATE SET season_id=EXCLUDED.season_id, starting_mmr=EXCLUDED.starting_mmr, updated_at=now()
    `);
    const saved = await bulkUpsertPlayers(seasonNumber, seasonId, players);
    res.setHeader("Cache-Control", "no-store");
    return void res.status(200).json({ ok: true, saved, received: players.length });
  } catch (error) {
    logger.error({ error }, "season fast snapshot failed");
    return void res.status(500).json({ error: "Falha ao sincronizar snapshot rápido da Season." });
  }
});

export default router;

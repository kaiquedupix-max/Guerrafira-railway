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

function errorInfo(error: unknown) {
  const e = error as { message?: unknown; code?: unknown; detail?: unknown; constraint?: unknown; stack?: unknown } | null;
  return {
    message: s(e?.message, 500),
    code: s(e?.code, 32),
    detail: s(e?.detail, 1000),
    constraint: s(e?.constraint, 128),
    stack: s(e?.stack, 4000),
  };
}

function rejectableDataError(error: unknown): boolean {
  const info = errorInfo(error);
  if (info.message.includes("steam_id inválido")) return true;
  return new Set(["22003", "22P02", "22007", "22008", "23502"]).has(info.code);
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
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS season_transactions (
      transaction_id TEXT PRIMARY KEY,
      season_number INTEGER NOT NULL,
      season_id TEXT NOT NULL,
      steam_id TEXT NOT NULL,
      player_name TEXT NOT NULL,
      category TEXT NOT NULL,
      event_type TEXT NOT NULL,
      base_value DOUBLE PRECISION NOT NULL DEFAULT 0,
      multiplier DOUBLE PRECISION NOT NULL DEFAULT 1,
      final_value DOUBLE PRECISION NOT NULL DEFAULT 0,
      resulting_mmr DOUBLE PRECISION NOT NULL DEFAULT 1000,
      details TEXT,
      happened_at TIMESTAMPTZ NOT NULL,
      received_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

type TargetSeason = {
  seasonNumber: number;
  seasonId: string;
  startingMmr: number;
  status: string;
};

async function resolveTargetSeason(incomingSeasonNumber: number, incomingSeasonId: string): Promise<TargetSeason | null> {
  const byId: any = await db.execute(sql`
    SELECT season_number, season_id, starting_mmr, status
    FROM seasons
    WHERE season_id = ${incomingSeasonId}
    ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, season_number DESC
    LIMIT 1
  `);
  const idRow = byId?.rows?.[0];
  if (idRow) {
    return {
      seasonNumber: Math.max(1, i(idRow.season_number, incomingSeasonNumber || 1)),
      seasonId: s(idRow.season_id, 64),
      startingMmr: n(idRow.starting_mmr, 1000),
      status: s(idRow.status, 32),
    };
  }

  if (incomingSeasonNumber > 0) {
    const byNumber: any = await db.execute(sql`
      SELECT season_number, season_id, starting_mmr, status
      FROM seasons
      WHERE season_number = ${incomingSeasonNumber}
      LIMIT 1
    `);
    const numberRow = byNumber?.rows?.[0];
    if (numberRow && s(numberRow.season_id, 64) === incomingSeasonId) {
      return {
        seasonNumber: Math.max(1, i(numberRow.season_number, incomingSeasonNumber)),
        seasonId: s(numberRow.season_id, 64),
        startingMmr: n(numberRow.starting_mmr, 1000),
        status: s(numberRow.status, 32),
      };
    }
  }

  return null;
}

function cleanPlayer(raw: Record<string, unknown>) {
  const steamId = s(raw.steam_id || raw.steamId, 32);
  if (!/^7656119\d{10}$/.test(steamId)) throw new Error("steam_id inválido");
  return {
    steamId,
    playerName: s(raw.player_name || raw.playerName || steamId, 128),
    mmr: n(raw.mmr, 1000),
    pvpRaidMmr: n(raw.pvp_raid_mmr),
    farmMmr: n(raw.farm_mmr),
    buildingMmr: n(raw.building_mmr),
    eventMmr: n(raw.event_mmr),
    otherMmr: n(raw.other_mmr),
    kills: i(raw.kills),
    deaths: i(raw.deaths),
    headshots: i(raw.headshots),
    assists: i(raw.assists),
    wood: i(raw.wood),
    stone: i(raw.stone),
    metalOre: i(raw.metal_ore),
    sulfurOre: i(raw.sulfur_ore),
    hqmOre: i(raw.hqm_ore),
    buildWood: i(raw.build_wood),
    buildStone: i(raw.build_stone),
    buildMetal: i(raw.build_metal),
    buildArmored: i(raw.build_armored),
    rocketsUsed: i(raw.rockets_used),
    c4Used: i(raw.c4_used),
    satchelsUsed: i(raw.satchels_used),
    raidStructuresDestroyed: i(raw.raid_structures_destroyed),
    tcsDestroyed: i(raw.tcs_destroyed),
    raidsParticipated: i(raw.raids_participated),
    raidsDefended: i(raw.raids_defended),
    bradleyParticipations: i(raw.bradley_participations),
    heliParticipations: i(raw.heli_participations),
    cratesHacked: i(raw.crates_hacked),
  };
}

async function upsertPlayer(seasonNumber: number, seasonId: string, raw: Record<string, unknown>) {
  const p = cleanPlayer(raw);
  await db.execute(sql`
    INSERT INTO season_players (
      season_number, season_id, steam_id, player_name, mmr,
      pvp_raid_mmr, farm_mmr, building_mmr, event_mmr, other_mmr,
      kills, deaths, headshots, assists,
      wood, stone, metal_ore, sulfur_ore, hqm_ore,
      build_wood, build_stone, build_metal, build_armored,
      rockets_used, c4_used, satchels_used, raid_structures_destroyed,
      tcs_destroyed, raids_participated, raids_defended,
      bradley_participations, heli_participations, crates_hacked, updated_at
    ) VALUES (
      ${seasonNumber}, ${seasonId}, ${p.steamId}, ${p.playerName}, ${p.mmr},
      ${p.pvpRaidMmr}, ${p.farmMmr}, ${p.buildingMmr}, ${p.eventMmr}, ${p.otherMmr},
      ${p.kills}, ${p.deaths}, ${p.headshots}, ${p.assists},
      ${p.wood}, ${p.stone}, ${p.metalOre}, ${p.sulfurOre}, ${p.hqmOre},
      ${p.buildWood}, ${p.buildStone}, ${p.buildMetal}, ${p.buildArmored},
      ${p.rocketsUsed}, ${p.c4Used}, ${p.satchelsUsed}, ${p.raidStructuresDestroyed},
      ${p.tcsDestroyed}, ${p.raidsParticipated}, ${p.raidsDefended},
      ${p.bradleyParticipations}, ${p.heliParticipations}, ${p.cratesHacked}, now()
    )
    ON CONFLICT (season_number, steam_id) DO UPDATE SET
      season_id = EXCLUDED.season_id,
      player_name = EXCLUDED.player_name,
      mmr = EXCLUDED.mmr,
      pvp_raid_mmr = EXCLUDED.pvp_raid_mmr,
      farm_mmr = EXCLUDED.farm_mmr,
      building_mmr = EXCLUDED.building_mmr,
      event_mmr = EXCLUDED.event_mmr,
      other_mmr = EXCLUDED.other_mmr,
      kills = EXCLUDED.kills,
      deaths = EXCLUDED.deaths,
      headshots = EXCLUDED.headshots,
      assists = EXCLUDED.assists,
      wood = EXCLUDED.wood,
      stone = EXCLUDED.stone,
      metal_ore = EXCLUDED.metal_ore,
      sulfur_ore = EXCLUDED.sulfur_ore,
      hqm_ore = EXCLUDED.hqm_ore,
      build_wood = EXCLUDED.build_wood,
      build_stone = EXCLUDED.build_stone,
      build_metal = EXCLUDED.build_metal,
      build_armored = EXCLUDED.build_armored,
      rockets_used = EXCLUDED.rockets_used,
      c4_used = EXCLUDED.c4_used,
      satchels_used = EXCLUDED.satchels_used,
      raid_structures_destroyed = EXCLUDED.raid_structures_destroyed,
      tcs_destroyed = EXCLUDED.tcs_destroyed,
      raids_participated = EXCLUDED.raids_participated,
      raids_defended = EXCLUDED.raids_defended,
      bradley_participations = EXCLUDED.bradley_participations,
      heli_participations = EXCLUDED.heli_participations,
      crates_hacked = EXCLUDED.crates_hacked,
      updated_at = now()
  `);
  return p;
}

router.post("/season/events", async (req, res) => {
  if (!secretValue()) return void res.status(503).json({ error: "Segredo da Season não configurado." });
  if (!authorized(req.header("x-gf-season-secret"))) return void res.status(401).json({ error: "Assinatura da Season inválida." });

  const events = Array.isArray(req.body?.events) ? req.body.events.slice(0, 250) : [];
  if (!events.length) return void res.status(400).json({ error: "Nenhum evento recebido." });

  try {
    await ensureTables();
    let accepted = 0;
    let duplicates = 0;
    let rejected = 0;
    let stale = 0;
    let remapped = 0;
    const targetCache = new Map<string, TargetSeason | null>();

    for (const raw of events) {
      if (!raw || typeof raw !== "object") { rejected++; continue; }
      const e = raw as Record<string, any>;
      const transactionId = s(e.transaction_id, 64).toLowerCase();
      const incomingSeasonId = s(e.season_id, 64);
      const incomingSeasonNumber = i(e.season_number);
      const player = (e.player && typeof e.player === "object" ? e.player : {}) as Record<string, unknown>;

      if (!/^[a-f0-9-]{16,64}$/.test(transactionId) || incomingSeasonNumber < 1 || !incomingSeasonId) {
        rejected++;
        continue;
      }

      const cacheKey = `${incomingSeasonNumber}:${incomingSeasonId}`;
      let target = targetCache.get(cacheKey);
      if (target === undefined) {
        target = await resolveTargetSeason(incomingSeasonNumber, incomingSeasonId);
        targetCache.set(cacheKey, target);
      }

      if (!target) {
        stale++;
        continue;
      }
      if (incomingSeasonNumber !== target.seasonNumber) remapped++;

      try {
        const p = cleanPlayer(player);
        const timestampUnix = Math.max(1, Math.min(i(e.timestamp_unix, Math.floor(Date.now() / 1000)), 4_102_444_800));
        const receipt: any = await db.execute(sql`
          INSERT INTO season_transactions (
            transaction_id, season_number, season_id, steam_id, player_name, category, event_type,
            base_value, multiplier, final_value, resulting_mmr, details, happened_at
          ) VALUES (
            ${transactionId}, ${target.seasonNumber}, ${target.seasonId}, ${p.steamId}, ${p.playerName},
            ${s(e.category, 64)}, ${s(e.event_type, 128)}, ${n(e.base_value)}, ${n(e.multiplier, 1)},
            ${n(e.final_value)}, ${p.mmr}, ${s(e.details, 4000)}, to_timestamp(${timestampUnix})
          )
          ON CONFLICT DO NOTHING
          RETURNING transaction_id
        `);

        const inserted = Array.isArray(receipt?.rows)
          ? receipt.rows.length > 0
          : Number(receipt?.rowCount || 0) > 0;

        if (!inserted) {
          duplicates++;
          continue;
        }

        try {
          await upsertPlayer(target.seasonNumber, target.seasonId, player);
          accepted++;
        } catch (error) {
          await db.execute(sql`DELETE FROM season_transactions WHERE transaction_id = ${transactionId}`).catch(() => {});
          throw error;
        }
      } catch (error) {
        if (rejectableDataError(error)) {
          rejected++;
          logger.warn({
            event: { transactionId, steamId: s(player.steam_id || player.steamId, 32) },
            err: errorInfo(error),
          }, "season event rejected without blocking queue");
          continue;
        }
        throw error;
      }
    }

    logger.info({ accepted, duplicates, rejected, stale, remapped, received: events.length }, "season batch ingested");
    res.setHeader("Cache-Control", "no-store");
    return void res.status(200).json({ ok: true, accepted, duplicates, rejected, stale, remapped });
  } catch (error) {
    logger.error({ err: errorInfo(error) }, "season safe ingestion failed");
    return void res.status(500).json({ error: "Falha ao armazenar eventos da Season." });
  }
});

router.post("/season/snapshot", async (req, res) => {
  if (!secretValue()) return void res.status(503).json({ error: "Segredo da Season não configurado." });
  if (!authorized(req.header("x-gf-season-secret"))) return void res.status(401).json({ error: "Assinatura da Season inválida." });

  try {
    await ensureTables();
    const incomingSeasonNumber = i(req.body?.season_number);
    const incomingSeasonId = s(req.body?.season_id, 64);
    const players = Array.isArray(req.body?.players) ? req.body.players.slice(0, 5000) : [];

    if (incomingSeasonNumber < 1 || !incomingSeasonId) {
      return void res.status(400).json({ error: "Season inválida." });
    }

    const target = await resolveTargetSeason(incomingSeasonNumber, incomingSeasonId);
    if (!target) {
      res.setHeader("Cache-Control", "no-store");
      return void res.status(200).json({ ok: true, stale: true, saved: 0, rejected: 0, received: players.length });
    }

    let saved = 0;
    let rejected = 0;

    for (const raw of players) {
      if (!raw || typeof raw !== "object") { rejected++; continue; }
      try {
        await upsertPlayer(target.seasonNumber, target.seasonId, raw as Record<string, unknown>);
        saved++;
      } catch (error) {
        if (rejectableDataError(error)) {
          rejected++;
          continue;
        }
        throw error;
      }
    }

    logger.info({
      incomingSeasonNumber,
      incomingSeasonId,
      targetSeasonNumber: target.seasonNumber,
      targetSeasonId: target.seasonId,
      saved,
      rejected,
      received: players.length,
    }, "season snapshot ingested");

    res.setHeader("Cache-Control", "no-store");
    return void res.status(200).json({
      ok: true,
      saved,
      rejected,
      received: players.length,
      remapped: incomingSeasonNumber !== target.seasonNumber,
      canonical_season_number: target.seasonNumber,
    });
  } catch (error) {
    logger.error({ err: errorInfo(error) }, "season safe snapshot failed");
    return void res.status(500).json({ error: "Falha ao sincronizar snapshot da Season." });
  }
});

export default router;

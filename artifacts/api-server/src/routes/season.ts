import { Router, type IRouter } from "express";
import { timingSafeEqual } from "node:crypto";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();
let initialized = false;

const GENERAL_THRESHOLD = 1700;

type RankInfo = {
  name: string;
  short: string;
  level: number;
  min: number;
  max: number | null;
  is_general: boolean;
};

const RANKS: RankInfo[] = [
  { name: "Recruta", short: "RCT", level: 1, min: 0, max: 1099.999, is_general: false },
  { name: "Soldado", short: "SLD", level: 2, min: 1100, max: 1249.999, is_general: false },
  { name: "Capitão", short: "CAP", level: 3, min: 1250, max: 1449.999, is_general: false },
  { name: "Coronel", short: "CEL", level: 4, min: 1450, max: 1699.999, is_general: false },
  { name: "General de Guerra", short: "GEN", level: 5, min: GENERAL_THRESHOLD, max: null, is_general: true },
];

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

function rankForMmr(mmrValue: unknown): RankInfo {
  const mmr = n(mmrValue, 1000);
  if (mmr >= GENERAL_THRESHOLD) return RANKS[4];
  if (mmr >= 1450) return RANKS[3];
  if (mmr >= 1250) return RANKS[2];
  if (mmr >= 1100) return RANKS[1];
  return RANKS[0];
}

function actionLabels(row: Record<string, any>): string[] {
  const actions: string[] = [];
  if (i(row.kills) > 0) actions.push("Eliminações PvP");
  if (i(row.headshots) > 0) actions.push("Headshots");
  if (i(row.assists) > 0) actions.push("Assistências");
  if (i(row.raids_participated) > 0) actions.push("Participação em raids");
  if (i(row.raids_defended) > 0) actions.push("Defesa de raids");
  if (i(row.raid_structures_destroyed) > 0 || i(row.tcs_destroyed) > 0) actions.push("Destruição em raids");
  if (i(row.rockets_used) > 0 || i(row.c4_used) > 0 || i(row.satchels_used) > 0) actions.push("Uso de explosivos em raid");
  if (i(row.wood) > 0) actions.push("Farm de madeira");
  if (i(row.stone) > 0) actions.push("Farm de pedra");
  if (i(row.metal_ore) > 0) actions.push("Farm de minério de metal");
  if (i(row.sulfur_ore) > 0) actions.push("Farm de enxofre");
  if (i(row.hqm_ore) > 0) actions.push("Farm de HQM");
  if (i(row.build_wood) > 0 || i(row.build_stone) > 0 || i(row.build_metal) > 0 || i(row.build_armored) > 0) actions.push("Construção e evolução de base");
  if (i(row.bradley_participations) > 0) actions.push("Bradley APC");
  if (i(row.heli_participations) > 0) actions.push("Helicóptero de Patrulha");
  if (i(row.crates_hacked) > 0) actions.push("Caixas hackeadas");
  return actions;
}

function publicPlayer(row: Record<string, any>, position?: number) {
  const rank = rankForMmr(row.mmr);
  const result: Record<string, any> = {
    position: position ?? i(row.position),
    steam_id: s(row.steam_id, 32),
    player_name: s(row.player_name, 128),
    patente: rank.name,
    patente_codigo: rank.short,
    patente_nivel: rank.level,
    patente_maxima: rank.is_general,
    kills: i(row.kills),
    deaths: i(row.deaths),
    headshots: i(row.headshots),
    assists: i(row.assists),
    raids_participated: i(row.raids_participated),
    raids_defended: i(row.raids_defended),
    bradley_participations: i(row.bradley_participations),
    heli_participations: i(row.heli_participations),
    crates_hacked: i(row.crates_hacked),
    actions: actionLabels(row),
    updated_at: row.updated_at,
  };

  // MMR fica oculto para todas as patentes. Somente Generais recebem uma
  // pontuação comparativa pública para ordenar quem lidera a patente máxima.
  if (rank.is_general) result.general_score = Math.round(n(row.mmr) * 100) / 100;
  return result;
}

async function initializeSeasonTables() {
  if (initialized) return;
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
  await db.execute(sql`CREATE INDEX IF NOT EXISTS season_players_rank_idx ON season_players(season_number, mmr DESC)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS season_transactions_player_idx ON season_transactions(season_number, steam_id, happened_at DESC)`);
  initialized = true;
}

async function upsertSeason(seasonNumber: number, seasonId: string, startingMmr = 1000) {
  await db.execute(sql`
    INSERT INTO seasons (season_number, season_id, starting_mmr, status, updated_at)
    VALUES (${seasonNumber}, ${seasonId}, ${startingMmr}, 'active', now())
    ON CONFLICT (season_number) DO UPDATE SET season_id = EXCLUDED.season_id, updated_at = now()
  `);
}

async function upsertPlayer(seasonNumber: number, seasonId: string, p: Record<string, unknown>) {
  const steamId = s(p.steam_id || p.steamId, 32);
  if (!/^7656119\d{10}$/.test(steamId) && steamId !== "0") throw new Error("steam_id inválido");
  const playerName = s(p.player_name || p.playerName || steamId, 128);

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
      ${seasonNumber}, ${seasonId}, ${steamId}, ${playerName}, ${n(p.mmr, 1000)},
      ${n(p.pvp_raid_mmr)}, ${n(p.farm_mmr)}, ${n(p.building_mmr)}, ${n(p.event_mmr)}, ${n(p.other_mmr)},
      ${i(p.kills)}, ${i(p.deaths)}, ${i(p.headshots)}, ${i(p.assists)},
      ${i(p.wood)}, ${i(p.stone)}, ${i(p.metal_ore)}, ${i(p.sulfur_ore)}, ${i(p.hqm_ore)},
      ${i(p.build_wood)}, ${i(p.build_stone)}, ${i(p.build_metal)}, ${i(p.build_armored)},
      ${i(p.rockets_used)}, ${i(p.c4_used)}, ${i(p.satchels_used)}, ${i(p.raid_structures_destroyed)},
      ${i(p.tcs_destroyed)}, ${i(p.raids_participated)}, ${i(p.raids_defended)},
      ${i(p.bradley_participations)}, ${i(p.heli_participations)}, ${i(p.crates_hacked)}, now()
    )
    ON CONFLICT (season_number, steam_id) DO UPDATE SET
      season_id=EXCLUDED.season_id, player_name=EXCLUDED.player_name, mmr=EXCLUDED.mmr,
      pvp_raid_mmr=EXCLUDED.pvp_raid_mmr, farm_mmr=EXCLUDED.farm_mmr,
      building_mmr=EXCLUDED.building_mmr, event_mmr=EXCLUDED.event_mmr, other_mmr=EXCLUDED.other_mmr,
      kills=EXCLUDED.kills, deaths=EXCLUDED.deaths, headshots=EXCLUDED.headshots, assists=EXCLUDED.assists,
      wood=EXCLUDED.wood, stone=EXCLUDED.stone, metal_ore=EXCLUDED.metal_ore,
      sulfur_ore=EXCLUDED.sulfur_ore, hqm_ore=EXCLUDED.hqm_ore,
      build_wood=EXCLUDED.build_wood, build_stone=EXCLUDED.build_stone,
      build_metal=EXCLUDED.build_metal, build_armored=EXCLUDED.build_armored,
      rockets_used=EXCLUDED.rockets_used, c4_used=EXCLUDED.c4_used, satchels_used=EXCLUDED.satchels_used,
      raid_structures_destroyed=EXCLUDED.raid_structures_destroyed, tcs_destroyed=EXCLUDED.tcs_destroyed,
      raids_participated=EXCLUDED.raids_participated, raids_defended=EXCLUDED.raids_defended,
      bradley_participations=EXCLUDED.bradley_participations, heli_participations=EXCLUDED.heli_participations,
      crates_hacked=EXCLUDED.crates_hacked, updated_at=now()
  `);
}

router.post("/season/events", async (req, res) => {
  if (!secretValue()) return void res.status(503).json({ error: "SEASON_WEBHOOK_SECRET/LEADERBOARD_WEBHOOK_SECRET não configurado." });
  if (!authorized(req.header("x-gf-season-secret"))) return void res.status(401).json({ error: "Assinatura da Season inválida." });

  const events = Array.isArray(req.body?.events) ? req.body.events.slice(0, 100) : [];
  if (!events.length) return void res.status(400).json({ error: "Nenhum evento recebido." });

  try {
    await initializeSeasonTables();
    let accepted = 0, duplicates = 0, rejected = 0;
    const seasonKeys = new Set<string>();

    for (const raw of events) {
      if (!raw || typeof raw !== "object") { rejected++; continue; }
      const e = raw as Record<string, any>;
      const transactionId = s(e.transaction_id, 64).toLowerCase();
      const seasonNumber = i(e.season_number);
      const seasonId = s(e.season_id, 64);
      const p = (e.player && typeof e.player === "object" ? e.player : {}) as Record<string, unknown>;
      if (!/^[a-f0-9-]{16,64}$/.test(transactionId) || seasonNumber < 1 || !seasonId) { rejected++; continue; }

      const seasonKey = `${seasonNumber}:${seasonId}`;
      if (!seasonKeys.has(seasonKey)) {
        await upsertSeason(seasonNumber, seasonId, n(e.starting_mmr, 1000));
        seasonKeys.add(seasonKey);
      }

      const receipt: any = await db.execute(sql`
        INSERT INTO season_transactions (
          transaction_id, season_number, season_id, steam_id, player_name, category, event_type,
          base_value, multiplier, final_value, resulting_mmr, details, happened_at
        ) VALUES (
          ${transactionId}, ${seasonNumber}, ${seasonId}, ${s(p.steam_id,32)}, ${s(p.player_name,128)},
          ${s(e.category,64)}, ${s(e.event_type,128)}, ${n(e.base_value)}, ${n(e.multiplier,1)},
          ${n(e.final_value)}, ${n(p.mmr,1000)}, ${s(e.details,4000)},
          to_timestamp(${Math.max(0, n(e.timestamp_unix))})
        ) ON CONFLICT DO NOTHING RETURNING transaction_id
      `);
      const inserted = Array.isArray(receipt?.rows) ? receipt.rows.length > 0 : Number(receipt?.rowCount || 0) > 0;
      if (!inserted) { duplicates++; continue; }
      try {
        await upsertPlayer(seasonNumber, seasonId, p);
        accepted++;
      } catch (error) {
        await db.execute(sql`DELETE FROM season_transactions WHERE transaction_id=${transactionId}`).catch(() => {});
        throw error;
      }
    }
    res.setHeader("Cache-Control", "no-store");
    return void res.status(200).json({ ok: true, accepted, duplicates, rejected });
  } catch (error) {
    logger.error({ error }, "season ingestion failed");
    return void res.status(500).json({ error: "Falha ao armazenar eventos da Season." });
  }
});

router.post("/season/snapshot", async (req, res) => {
  if (!secretValue()) return void res.status(503).json({ error: "Segredo da Season não configurado." });
  if (!authorized(req.header("x-gf-season-secret"))) return void res.status(401).json({ error: "Assinatura da Season inválida." });
  try {
    await initializeSeasonTables();
    const seasonNumber = i(req.body?.season_number);
    const seasonId = s(req.body?.season_id, 64);
    const players = Array.isArray(req.body?.players) ? req.body.players.slice(0, 1000) : [];
    if (seasonNumber < 1 || !seasonId) return void res.status(400).json({ error: "Season inválida." });
    await upsertSeason(seasonNumber, seasonId, n(req.body?.starting_mmr, 1000));
    let saved = 0;
    for (const p of players) {
      if (!p || typeof p !== "object") continue;
      await upsertPlayer(seasonNumber, seasonId, p as Record<string, unknown>);
      saved++;
    }
    res.setHeader("Cache-Control", "no-store");
    return void res.status(200).json({ ok: true, saved });
  } catch (error) {
    logger.error({ error }, "season snapshot failed");
    return void res.status(500).json({ error: "Falha ao sincronizar snapshot da Season." });
  }
});

router.get("/season/:number", async (req, res) => {
  try {
    await initializeSeasonTables();
    const seasonNumber = Math.max(1, i(req.params.number, 1));
    const limit = Math.min(300, Math.max(10, i(req.query.limit, 100)));

    const seasonResult: any = await db.execute(sql`
      SELECT season_number, season_id, status, started_at, ended_at, updated_at
      FROM seasons WHERE season_number=${seasonNumber} LIMIT 1
    `);
    const season = seasonResult?.rows?.[0] ?? null;

    const rankingResult: any = await db.execute(sql`
      SELECT *, ROW_NUMBER() OVER (ORDER BY mmr DESC, kills DESC, updated_at ASC) AS position
      FROM season_players
      WHERE season_number=${seasonNumber}
      ORDER BY mmr DESC, kills DESC, updated_at ASC
      LIMIT ${limit}
    `);

    const rows = (rankingResult?.rows ?? []) as Record<string, any>[];
    const ranking = rows.map((row, idx) => publicPlayer(row, idx + 1));
    const generalCount = ranking.filter((p: any) => p.patente_maxima).length;

    res.setHeader("Cache-Control", "public, max-age=10, stale-while-revalidate=20");
    return void res.json({
      ok: true,
      season_number: seasonNumber,
      season,
      methodology: {
        metric: "MMR",
        public_mmr: false,
        description: "As patentes são calculadas pelo MMR interno da Season. O MMR individual fica oculto; somente Generais de Guerra exibem Pontuação de General para comparação dentro da patente máxima.",
      },
      ranks: RANKS.map(({ name, short, level, min, is_general }) => ({ name, short, level, min, is_general })),
      general_count: generalCount,
      ranking,
    });
  } catch (error) {
    logger.error({ error }, "season ranking read failed");
    return void res.status(500).json({ error: "Falha ao carregar ranking da Season." });
  }
});

router.get("/season/:number/player/:steamId", async (req, res) => {
  try {
    await initializeSeasonTables();
    const seasonNumber = Math.max(1, i(req.params.number, 1));
    const steamId = s(req.params.steamId, 32);
    const playerResult: any = await db.execute(sql`
      SELECT *
      FROM (
        SELECT *, ROW_NUMBER() OVER (ORDER BY mmr DESC, kills DESC, updated_at ASC) AS position
        FROM season_players
        WHERE season_number=${seasonNumber}
      ) ranked
      WHERE steam_id=${steamId}
      LIMIT 1
    `);
    const playerRow = playerResult?.rows?.[0] ?? null;

    const txResult: any = await db.execute(sql`
      SELECT category, event_type,
        CASE WHEN final_value > 0 THEN 'gain' WHEN final_value < 0 THEN 'loss' ELSE 'neutral' END AS direction,
        details, happened_at
      FROM season_transactions
      WHERE season_number=${seasonNumber} AND steam_id=${steamId}
      ORDER BY happened_at DESC
      LIMIT 100
    `);

    return void res.json({
      ok: true,
      player: playerRow ? publicPlayer(playerRow) : null,
      transactions: txResult?.rows ?? [],
    });
  } catch (error) {
    logger.error({ error }, "season player read failed");
    return void res.status(500).json({ error: "Falha ao carregar jogador da Season." });
  }
});

router.post("/season/:number/finish", async (req, res) => {
  if (!authorized(req.header("x-gf-season-secret"))) return void res.status(401).json({ error: "Assinatura inválida." });
  try {
    await initializeSeasonTables();
    const seasonNumber = Math.max(1, i(req.params.number, 1));
    await db.execute(sql`UPDATE seasons SET status='finished', ended_at=COALESCE(ended_at,now()), updated_at=now() WHERE season_number=${seasonNumber}`);
    return void res.json({ ok: true });
  } catch (error) {
    logger.error({ error }, "season finish failed");
    return void res.status(500).json({ error: "Falha ao finalizar Season." });
  }
});

export default router;

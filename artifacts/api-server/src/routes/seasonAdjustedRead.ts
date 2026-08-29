import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();
const GENERAL_THRESHOLD = 1200;
const STARTING_MMR = 1000;

const RANKS = [
  { name: "Recruta", short: "RCT", level: 1, min: 1000, max: 1049.999, is_general: false },
  { name: "Soldado", short: "SLD", level: 2, min: 1050, max: 1099.999, is_general: false },
  { name: "Capitão", short: "CAP", level: 3, min: 1100, max: 1149.999, is_general: false },
  { name: "Coronel", short: "CEL", level: 4, min: 1150, max: 1199.999, is_general: false },
  { name: "General de Guerra", short: "GEN", level: 5, min: GENERAL_THRESHOLD, max: null, is_general: true },
];

const n = (v: unknown, f = 0) => Number.isFinite(Number(v)) ? Number(v) : f;
const i = (v: unknown, f = 0) => Math.trunc(n(v, f));
const s = (v: unknown, max = 1000) => String(v ?? "").slice(0, max);

function rankFor(v: unknown) {
  const mmr = n(v, STARTING_MMR);
  return mmr >= 1200 ? RANKS[4] : mmr >= 1150 ? RANKS[3] : mmr >= 1100 ? RANKS[2] : mmr >= 1050 ? RANKS[1] : RANKS[0];
}

function actions(row: any) {
  const a: string[] = [];
  if (i(row.kills) > 0) a.push("Eliminações PvP");
  if (i(row.headshots) > 0) a.push("Headshots");
  if (i(row.assists) > 0) a.push("Assistências");
  if (i(row.raids_participated) > 0) a.push("Participação em raids");
  if (i(row.raids_defended) > 0) a.push("Defesa de raids");
  if (i(row.wood) > 0 || i(row.stone) > 0 || i(row.metal_ore) > 0 || i(row.sulfur_ore) > 0 || i(row.hqm_ore) > 0) a.push("Farm");
  if (i(row.bradley_participations) > 0) a.push("Bradley APC");
  if (i(row.heli_participations) > 0) a.push("Helicóptero de Patrulha");
  if (i(row.crates_hacked) > 0) a.push("Caixas hackeadas");
  return a;
}

function publicPlayer(row: any, position?: number) {
  const mmr = n(row.effective_mmr, row.mmr ?? STARTING_MMR);
  const rank = rankFor(mmr);
  const out: any = {
    position: position ?? i(row.position),
    steam_id: s(row.steam_id, 32),
    player_name: s(row.player_name, 128),
    patente: rank.name,
    patente_codigo: rank.short,
    patente_nivel: rank.level,
    patente_maxima: rank.is_general,
    season_scored: Boolean(row.season_scored),
    kills: i(row.kills),
    deaths: i(row.deaths),
    headshots: i(row.headshots),
    assists: i(row.assists),
    raids_participated: i(row.raids_participated),
    raids_defended: i(row.raids_defended),
    bradley_participations: i(row.bradley_participations),
    heli_participations: i(row.heli_participations),
    crates_hacked: i(row.crates_hacked),
    actions: actions(row),
    updated_at: row.updated_at,
  };
  if (rank.is_general) out.general_score = Math.round(mmr * 100) / 100;
  return out;
}

type SeasonDataSource = {
  season_number: number;
  player_count: number;
  last_update: any;
  season_id: string | null;
  status: string | null;
};

async function resolveSeasonDataSource(requestedSeasonNumber: number): Promise<{ sourceSeasonNumber: number; candidates: SeasonDataSource[] }> {
  const statsResult: any = await db.execute(sql`
    SELECT p.season_number,
           COUNT(*)::int AS player_count,
           MAX(p.updated_at) AS last_update,
           MAX(s.season_id) AS season_id,
           MAX(s.status) AS status
    FROM season_players p
    LEFT JOIN seasons s ON s.season_number = p.season_number
    GROUP BY p.season_number
    ORDER BY
      CASE WHEN MAX(s.status) = 'active' THEN 0 ELSE 1 END,
      MAX(p.updated_at) DESC NULLS LAST,
      p.season_number DESC
  `);

  const candidates = ((statsResult?.rows ?? []) as any[]).map(r => ({
    season_number: i(r.season_number),
    player_count: i(r.player_count),
    last_update: r.last_update ?? null,
    season_id: r.season_id == null ? null : s(r.season_id, 128),
    status: r.status == null ? null : s(r.status, 32),
  })).filter(r => r.player_count > 0);

  const active = candidates.filter(r => r.status === "active").sort((a, b) => {
    const at = a.last_update ? new Date(a.last_update).getTime() : 0;
    const bt = b.last_update ? new Date(b.last_update).getTime() : 0;
    return bt - at || b.season_number - a.season_number;
  })[0];

  const requested = candidates.find(r => r.season_number === requestedSeasonNumber);
  return { sourceSeasonNumber: active?.season_number ?? requested?.season_number ?? requestedSeasonNumber, candidates };
}

function universeSql(sourceSeasonNumber: number) {
  return sql`
    WITH admin_delta AS (
      SELECT steam_id, COALESCE(SUM(final_value), 0) AS delta
      FROM season_transactions
      WHERE season_number = ${sourceSeasonNumber} AND category = 'admin'
      GROUP BY steam_id
    ),
    season_data AS (
      SELECT * FROM season_players WHERE season_number = ${sourceSeasonNumber}
    ),
    universe AS (
      SELECT
        ps.steam_id,
        COALESCE(sd.player_name, ps.player_name) AS player_name,
        COALESCE(sd.mmr, ${STARTING_MMR}) AS mmr,
        COALESCE(sd.pvp_raid_mmr, 0) AS pvp_raid_mmr,
        COALESCE(sd.farm_mmr, 0) AS farm_mmr,
        COALESCE(sd.building_mmr, 0) AS building_mmr,
        COALESCE(sd.event_mmr, 0) AS event_mmr,
        COALESCE(sd.other_mmr, 0) AS other_mmr,
        COALESCE(sd.kills, ps.kills, 0) AS kills,
        COALESCE(sd.deaths, ps.deaths, 0) AS deaths,
        COALESCE(sd.headshots, ps.headshots, 0) AS headshots,
        COALESCE(sd.assists, 0) AS assists,
        COALESCE(sd.wood, ps.wood_gathered, 0) AS wood,
        COALESCE(sd.stone, ps.stone_gathered, 0) AS stone,
        COALESCE(sd.metal_ore, ps.metal_ore_gathered, 0) AS metal_ore,
        COALESCE(sd.sulfur_ore, ps.sulfur_ore_gathered, 0) AS sulfur_ore,
        COALESCE(sd.hqm_ore, 0) AS hqm_ore,
        COALESCE(sd.raids_participated, 0) AS raids_participated,
        COALESCE(sd.raids_defended, 0) AS raids_defended,
        COALESCE(sd.bradley_participations, 0) AS bradley_participations,
        COALESCE(sd.heli_participations, 0) AS heli_participations,
        COALESCE(sd.crates_hacked, 0) AS crates_hacked,
        COALESCE(sd.updated_at, ps.updated_at) AS updated_at,
        (sd.steam_id IS NOT NULL) AS season_scored
      FROM player_stats ps
      LEFT JOIN season_data sd ON sd.steam_id = ps.steam_id

      UNION ALL

      SELECT
        sd.steam_id, sd.player_name, sd.mmr,
        sd.pvp_raid_mmr, sd.farm_mmr, sd.building_mmr, sd.event_mmr, sd.other_mmr,
        sd.kills, sd.deaths, sd.headshots, sd.assists,
        sd.wood, sd.stone, sd.metal_ore, sd.sulfur_ore, sd.hqm_ore,
        sd.raids_participated, sd.raids_defended,
        sd.bradley_participations, sd.heli_participations, sd.crates_hacked,
        sd.updated_at, true AS season_scored
      FROM season_data sd
      LEFT JOIN player_stats ps ON ps.steam_id = sd.steam_id
      WHERE ps.steam_id IS NULL
    ),
    ranked AS (
      SELECT u.*,
             COALESCE(a.delta, 0) AS admin_delta,
             u.mmr + COALESCE(a.delta, 0) AS effective_mmr,
             ROW_NUMBER() OVER (
               ORDER BY u.mmr + COALESCE(a.delta, 0) DESC,
                        u.kills DESC,
                        u.updated_at ASC NULLS LAST,
                        u.player_name ASC
             ) AS position
      FROM universe u
      LEFT JOIN admin_delta a ON a.steam_id = u.steam_id
    )
    SELECT * FROM ranked
  `;
}

router.get("/season/:number", async (req, res, next) => {
  if (!/^\d+$/.test(String(req.params.number || ""))) return next();
  try {
    const seasonNumber = Math.max(1, i(req.params.number, 1));
    const { sourceSeasonNumber, candidates } = await resolveSeasonDataSource(seasonNumber);

    const seasonResult: any = await db.execute(sql`
      SELECT season_number, season_id, status, started_at, ended_at, updated_at
      FROM seasons WHERE season_number = ${seasonNumber} LIMIT 1
    `);

    const rankingResult: any = await db.execute(sql`${universeSql(sourceSeasonNumber)} ORDER BY position ASC`);
    const rows = (rankingResult?.rows ?? []) as any[];
    const ranking = rows.map((r, idx) => publicPlayer(r, idx + 1));
    const seasonScoredPlayers = rows.filter(r => Boolean(r.season_scored)).length;
    const leaderboardPlayers = rows.length - seasonScoredPlayers;

    logger.info({
      requestedSeasonNumber: seasonNumber,
      sourceSeasonNumber,
      totalPlayers: ranking.length,
      seasonScoredPlayers,
      leaderboardOnlyPlayers: leaderboardPlayers,
      seasonPlayerSources: candidates.map(c => ({
        season_number: c.season_number,
        player_count: c.player_count,
        status: c.status,
        last_update: c.last_update,
      })),
    }, "season ranking merged with leaderboard universe");

    res.setHeader("Cache-Control", "no-store, max-age=0");
    return void res.json({
      ok: true,
      season_number: seasonNumber,
      data_source_season_number: sourceSeasonNumber,
      fallback_source: sourceSeasonNumber !== seasonNumber,
      season: seasonResult?.rows?.[0] ?? null,
      ranking_scope: "all_leaderboard_players_with_season_overlay",
      total_players: ranking.length,
      season_scored_players: seasonScoredPlayers,
      leaderboard_only_players: leaderboardPlayers,
      methodology: {
        metric: "MMR",
        public_mmr: false,
        description: "A Season usa a mesma base universal de jogadores do Leaderboard. Todo jogador conhecido no wipe aparece no ranking. Quando há estado da Season, patente e pontuação usam o MMR da Season; quem ainda não possui evento válido entra como Recruta no MMR inicial. Inscrição não é requisito para aparecer.",
      },
      ranks: RANKS,
      general_count: ranking.filter((p: any) => p.patente_maxima).length,
      ranking,
    });
  } catch (error) {
    logger.error({ error }, "adjusted season ranking failed");
    return void res.status(500).json({ error: "Falha ao carregar ranking da Season." });
  }
});

router.get("/season/:number/player/:steamId", async (req, res, next) => {
  const steamId = s(req.params.steamId, 32);
  if (!/^7656119\d{10}$/.test(steamId)) return next();

  try {
    const seasonNumber = Math.max(1, i(req.params.number, 1));
    const { sourceSeasonNumber } = await resolveSeasonDataSource(seasonNumber);
    const playerResult: any = await db.execute(sql`
      ${universeSql(sourceSeasonNumber)}
      WHERE steam_id = ${steamId}
      LIMIT 1
    `);
    const tx: any = await db.execute(sql`
      SELECT category, event_type,
             CASE WHEN final_value > 0 THEN 'gain' WHEN final_value < 0 THEN 'loss' ELSE 'neutral' END direction,
             details, happened_at
      FROM season_transactions
      WHERE season_number = ${sourceSeasonNumber} AND steam_id = ${steamId}
      ORDER BY happened_at DESC
      LIMIT 100
    `);

    return void res.json({
      ok: true,
      season_number: seasonNumber,
      data_source_season_number: sourceSeasonNumber,
      player: playerResult?.rows?.[0] ? publicPlayer(playerResult.rows[0]) : null,
      transactions: tx?.rows ?? [],
    });
  } catch (error) {
    logger.error({ error }, "adjusted season player failed");
    return void res.status(500).json({ error: "Falha ao carregar jogador da Season." });
  }
});

export default router;

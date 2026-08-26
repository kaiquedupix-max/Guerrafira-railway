import pg from "pg";

const { Pool } = pg;
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error("[season-db] DATABASE_URL não está configurada.");
  process.exit(1);
}

const pool = new Pool({
  connectionString,
  max: 1,
  connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 10_000,
  query_timeout: 65_000,
  statement_timeout: 60_000,
  application_name: "guerra-fria-season-predeploy",
});

const statements = [
  `SET lock_timeout = '10s'`,
  `SET statement_timeout = '60s'`,
  `CREATE TABLE IF NOT EXISTS seasons (season_number INTEGER PRIMARY KEY, season_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', starting_mmr DOUBLE PRECISION NOT NULL DEFAULT 1000, started_at TIMESTAMPTZ NOT NULL DEFAULT now(), ended_at TIMESTAMPTZ, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
  `CREATE TABLE IF NOT EXISTS season_players (season_number INTEGER NOT NULL, season_id TEXT NOT NULL, steam_id TEXT NOT NULL, player_name TEXT NOT NULL, mmr DOUBLE PRECISION NOT NULL DEFAULT 1000, pvp_raid_mmr DOUBLE PRECISION NOT NULL DEFAULT 0, farm_mmr DOUBLE PRECISION NOT NULL DEFAULT 0, building_mmr DOUBLE PRECISION NOT NULL DEFAULT 0, event_mmr DOUBLE PRECISION NOT NULL DEFAULT 0, other_mmr DOUBLE PRECISION NOT NULL DEFAULT 0, kills INTEGER NOT NULL DEFAULT 0, deaths INTEGER NOT NULL DEFAULT 0, headshots INTEGER NOT NULL DEFAULT 0, assists INTEGER NOT NULL DEFAULT 0, wood BIGINT NOT NULL DEFAULT 0, stone BIGINT NOT NULL DEFAULT 0, metal_ore BIGINT NOT NULL DEFAULT 0, sulfur_ore BIGINT NOT NULL DEFAULT 0, hqm_ore BIGINT NOT NULL DEFAULT 0, build_wood INTEGER NOT NULL DEFAULT 0, build_stone INTEGER NOT NULL DEFAULT 0, build_metal INTEGER NOT NULL DEFAULT 0, build_armored INTEGER NOT NULL DEFAULT 0, rockets_used INTEGER NOT NULL DEFAULT 0, c4_used INTEGER NOT NULL DEFAULT 0, satchels_used INTEGER NOT NULL DEFAULT 0, raid_structures_destroyed INTEGER NOT NULL DEFAULT 0, tcs_destroyed INTEGER NOT NULL DEFAULT 0, raids_participated INTEGER NOT NULL DEFAULT 0, raids_defended INTEGER NOT NULL DEFAULT 0, bradley_participations INTEGER NOT NULL DEFAULT 0, heli_participations INTEGER NOT NULL DEFAULT 0, crates_hacked INTEGER NOT NULL DEFAULT 0, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (season_number, steam_id))`,
  `CREATE TABLE IF NOT EXISTS season_transactions (transaction_id TEXT PRIMARY KEY, season_number INTEGER NOT NULL, season_id TEXT NOT NULL, steam_id TEXT NOT NULL, player_name TEXT NOT NULL, category TEXT NOT NULL, event_type TEXT NOT NULL, base_value DOUBLE PRECISION NOT NULL DEFAULT 0, multiplier DOUBLE PRECISION NOT NULL DEFAULT 1, final_value DOUBLE PRECISION NOT NULL DEFAULT 0, resulting_mmr DOUBLE PRECISION NOT NULL DEFAULT 1000, details TEXT, happened_at TIMESTAMPTZ NOT NULL, received_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
  `CREATE INDEX IF NOT EXISTS season_players_rank_idx ON season_players(season_number, mmr DESC)`,
  `CREATE INDEX IF NOT EXISTS season_transactions_player_idx ON season_transactions(season_number, steam_id, happened_at DESC)`,
];

try {
  for (const sql of statements) await pool.query(sql);
  console.log("[season-db] Tabelas da Season verificadas/criadas com sucesso.");
} catch (error) {
  console.error("[season-db] Falha ao inicializar schema da Season:", error);
  process.exitCode = 1;
} finally {
  await pool.end();
}

import pg from "pg";

const { Pool } = pg;
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error("[database] DATABASE_URL não está configurada.");
  process.exit(1);
}

const pool = new Pool({ connectionString });

const statements = [
  `CREATE TABLE IF NOT EXISTS players (
    id SERIAL PRIMARY KEY,
    steam_id TEXT NOT NULL UNIQUE,
    player_name TEXT NOT NULL,
    is_online BOOLEAN NOT NULL DEFAULT FALSE,
    first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS mod_logs (
    id SERIAL PRIMARY KEY,
    action TEXT NOT NULL,
    steam_id TEXT NOT NULL,
    player_name TEXT NOT NULL,
    reason TEXT,
    admin_id TEXT NOT NULL,
    admin_name TEXT NOT NULL,
    ban_duration TEXT,
    ban_expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS vip_subscriptions (
    id SERIAL PRIMARY KEY,
    discord_user_id VARCHAR(64) NOT NULL,
    steam_id VARCHAR(32) NOT NULL,
    vip_tier VARCHAR(16) NOT NULL,
    source VARCHAR(16) NOT NULL,
    duration_days INTEGER NOT NULL DEFAULT 30,
    starts_at TIMESTAMP NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    discord_role_removed BOOLEAN NOT NULL DEFAULT FALSE,
    game_vip_removed BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS payments (
    id SERIAL PRIMARY KEY,
    mp_payment_id VARCHAR(64),
    mp_preference_id VARCHAR(128),
    discord_user_id VARCHAR(64) NOT NULL,
    steam_id VARCHAR(32),
    email VARCHAR(128),
    vip_tier VARCHAR(16) NOT NULL,
    amount VARCHAR(16) NOT NULL,
    method VARCHAR(16),
    status VARCHAR(16) NOT NULL DEFAULT 'pending',
    ticket_channel_id VARCHAR(64),
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS raffles (
    id SERIAL PRIMARY KEY,
    prize_tier VARCHAR(16) NOT NULL,
    prize_duration_days INTEGER NOT NULL,
    message_id VARCHAR(64),
    channel_id VARCHAR(64),
    ends_at TIMESTAMP NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'active',
    winner_discord_id VARCHAR(64),
    winner_steam_id VARCHAR(32),
    created_by VARCHAR(64) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS raffle_entries (
    id SERIAL PRIMARY KEY,
    raffle_id INTEGER NOT NULL,
    discord_user_id VARCHAR(64) NOT NULL,
    steam_id VARCHAR(32) NOT NULL,
    entered_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS ticket_logs (
    id SERIAL PRIMARY KEY,
    ticket_channel_id VARCHAR(64) NOT NULL UNIQUE,
    channel_name VARCHAR(128),
    type VARCHAR(32),
    opened_by_discord_id VARCHAR(64) NOT NULL DEFAULT '',
    opened_by_username VARCHAR(128),
    closed_by_discord_id VARCHAR(64),
    closed_by_username VARCHAR(128),
    opened_at TIMESTAMP NOT NULL DEFAULT NOW(),
    closed_at TIMESTAMP,
    transcript TEXT,
    participant_ids TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS player_stats (
    id SERIAL PRIMARY KEY,
    steam_id TEXT NOT NULL UNIQUE,
    player_name TEXT NOT NULL,
    kills INTEGER NOT NULL DEFAULT 0,
    deaths INTEGER NOT NULL DEFAULT 0,
    headshots INTEGER NOT NULL DEFAULT 0,
    resources_gathered INTEGER NOT NULL DEFAULT 0,
    wood_gathered INTEGER NOT NULL DEFAULT 0,
    stone_gathered INTEGER NOT NULL DEFAULT 0,
    metal_ore_gathered INTEGER NOT NULL DEFAULT 0,
    sulfur_ore_gathered INTEGER NOT NULL DEFAULT 0,
    scrap_gathered INTEGER NOT NULL DEFAULT 0,
    explosives_crafted INTEGER NOT NULL DEFAULT 0,
    gunpowder_crafted INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  `ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS wood_gathered INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS stone_gathered INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS metal_ore_gathered INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS sulfur_ore_gathered INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS scrap_gathered INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS gunpowder_crafted INTEGER NOT NULL DEFAULT 0`,
  `CREATE TABLE IF NOT EXISTS booster_links (
    id SERIAL PRIMARY KEY,
    discord_user_id VARCHAR(64) NOT NULL UNIQUE,
    steam_id VARCHAR(32) NOT NULL,
    active BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
];

try {
  for (const sql of statements) await pool.query(sql);
  console.log("[database] Schema verificado/criado com sucesso.");
} catch (error) {
  console.error("[database] Falha ao inicializar schema:", error);
  process.exitCode = 1;
} finally {
  await pool.end();
}

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;
export { Pool };

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.PG_POOL_MAX || 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

// A transient PostgreSQL disconnect must not become an unhandled EventEmitter
// error that terminates the entire API process. Individual queries still reject
// normally and their route handlers can return an appropriate error response.
pool.on("error", (error) => {
  console.error("[db] PostgreSQL pool connection error:", error);
});

// Also migrate on startup: hosts without a pre-deploy hook must not run
// moderation against an unscoped audit schema. Existing records belong to Duo.
await pool.query({ text: "ALTER TABLE mod_logs ADD COLUMN IF NOT EXISTS server_id TEXT NOT NULL DEFAULT 'solo-duo'", query_timeout: 15000 });

export const db = drizzle(pool, { schema });

export * from "./schema";

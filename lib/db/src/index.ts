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

// Run explicitly from the application entry point after module initialization.
// Async database work during imports can stall bundled circular dependencies.
let schemaReady: Promise<void> | null = null;
export function ensureDatabaseSchema(): Promise<void> {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    const client = await pool.connect();
    try {
      const existing = await client.query(
        "SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('mod_logs') AND attname = 'server_id' AND NOT attisdropped"
      );
      if (existing.rowCount) return;
      await client.query("BEGIN");
      await client.query("SET LOCAL statement_timeout = '15s'");
      await client.query("ALTER TABLE mod_logs ADD COLUMN IF NOT EXISTS server_id TEXT NOT NULL DEFAULT 'solo-duo'");
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  })().catch(error => { schemaReady = null; throw error; });
  return schemaReady;
}

export const db = drizzle(pool, { schema });

export * from "./schema";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { pool } from "@workspace/db";
import { duoSecret } from "./duoPolicy.js";
let ready: Promise<void> | undefined;
function schema() {
  return ready ??= pool.query(`CREATE TABLE IF NOT EXISTS store_steam_auth (
    discord_id TEXT PRIMARY KEY, steam_id TEXT NOT NULL, verified_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`).then(() => undefined).catch(error => { ready = undefined; throw error; });
}
export async function officialSteam(discord: string, steam: string): Promise<boolean> {
  await schema();
  return Boolean((await pool.query("SELECT 1 FROM store_steam_auth WHERE discord_id=$1 AND steam_id=$2", [discord, steam])).rowCount);
}
export async function recordOfficialSteam(discord: string, steam: string): Promise<void> {
  await schema();
  await pool.query(`INSERT INTO store_steam_auth(discord_id,steam_id) VALUES($1,$2)
    ON CONFLICT(discord_id) DO UPDATE SET steam_id=$2,verified_at=now()`, [discord, steam]);
}
function signature(payload: string) { return createHmac("sha256", duoSecret()).update(`steam:${payload}`).digest("base64url"); }
export function steamState(user: string, duo: boolean) {
  const payload = Buffer.from(JSON.stringify({ user, duo, nonce: randomBytes(24).toString("hex"), exp: Date.now() + 600_000 })).toString("base64url");
  return `${payload}.${signature(payload)}`;
}
export function readSteamState(value: string, user: string): { nonce: string; duo: boolean } | null {
  const [payload, sig] = value.split(".");
  if (!payload || !sig) return null;
  const expected = signature(payload);
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const state = JSON.parse(Buffer.from(payload, "base64url").toString());
    return state.user === user && state.exp > Date.now() ? state : null;
  } catch { return null; }
}

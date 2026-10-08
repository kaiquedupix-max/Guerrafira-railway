import { pool } from "@workspace/db";
import type { VipProduct } from "../bot/vipProducts.js";
let ready: Promise<void> | undefined;
export function ensureCardAttempts() {
  return ready ??= pool.query(`CREATE TABLE IF NOT EXISTS store_card_attempts (
    attempt_id UUID PRIMARY KEY, payment_id INTEGER NOT NULL UNIQUE REFERENCES payments(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`).then(() => undefined).catch(error => { ready = undefined; throw error; });
}
type Purchase = { tier: VipProduct; steamId: string; discordUserId: string; email: string };
export function isAttemptId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
export async function cardAttempt(key: string, purchase: Purchase, price: number) {
  await ensureCardAttempts();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(120121, hashtext($1))", [key]);
    let row = (await client.query(`SELECT p.* FROM store_card_attempts a JOIN payments p ON p.id=a.payment_id WHERE a.attempt_id=$1`, [key])).rows[0];
    if (row) {
      if (row.discord_user_id !== purchase.discordUserId || row.steam_id !== purchase.steamId || row.vip_tier !== purchase.tier ||
        row.email !== purchase.email || Number(row.amount) !== price) throw new Error("Tentativa de pagamento inválida. Inicie novamente.");
    } else {
      row = (await client.query(`INSERT INTO payments(discord_user_id,steam_id,email,vip_tier,amount,method,status,mp_external_reference)
        VALUES($1,$2,$3,$4,$5,'credit_card','pending',$6) RETURNING *`,
      [purchase.discordUserId,purchase.steamId,purchase.email,purchase.tier,price.toFixed(2),`site-card-${key}`])).rows[0];
      await client.query("INSERT INTO store_card_attempts(attempt_id,payment_id) VALUES($1,$2)", [key,row.id]);
    }
    await client.query("COMMIT");
    return row;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

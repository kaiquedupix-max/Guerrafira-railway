import { randomBytes } from "node:crypto";
import { pool, Pool } from "@workspace/db";
import { discordClient } from "../bot/client.js";
import { grantVipProduct } from "../bot/vipProducts.js";
import { logger } from "../lib/logger.js";
import { recordStoreDelivery } from "./storeReceipts.js";
import { claimProblem, DUO_WINDOW_MS, duoToken, tokenHash, tokenMatches } from "./duoPolicy.js";
import { storeOrder } from './storeOrders.js';
import { selectedServers,storeQuote,type StoreSelection } from '../core/storePricing.js';

type Payment = { id: number; discord_user_id: string; steam_id: string; status: string; vip_tier: string; vip_granted_at: Date | null };
type Redemption = { payment_id: number; slot: number; nonce: string; token_hash: string; expires_at: Date; status: string;
  duo_discord_id: string | null; duo_steam_id: string | null; redeemed_at: Date | null };
let ready: Promise<void> | undefined;
// Separate connections keep advisory locks from exhausting the delivery query pool.
const lockPool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4, connectionTimeoutMillis: 10_000 });
lockPool.on("error", error => logger.error({ error }, "Duo lock connection failed"));
export function ensureDuoSchema(): Promise<void> {
  return ready ??= pool.query(`CREATE TABLE IF NOT EXISTS duo_redemptions (
    payment_id INTEGER PRIMARY KEY REFERENCES payments(id), nonce TEXT NOT NULL,
    token_hash TEXT UNIQUE NOT NULL, expires_at TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','delivering','redeemed')),
    duo_discord_id TEXT, duo_steam_id TEXT, redeemed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK ((duo_discord_id IS NULL) = (duo_steam_id IS NULL))
  )`).then(async () => { await pool.query(`DO $$ BEGIN
    PERFORM pg_advisory_xact_lock(84032018);
    ALTER TABLE duo_redemptions ADD COLUMN IF NOT EXISTS slot INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE duo_redemptions DROP CONSTRAINT IF EXISTS duo_redemptions_pkey;
    ALTER TABLE duo_redemptions ADD PRIMARY KEY(payment_id,slot);
    ALTER TABLE vip_subscriptions ALTER COLUMN source TYPE VARCHAR(64);
  END $$;`); }).catch(error => { ready = undefined; throw error; });
}

// Session advisory locks serialize external RCON delivery across instances. The
// association is committed before side effects; crashes cannot free a used link.
async function locked<T>(id: number, run: (payment: Payment, redemption: Redemption | undefined) => Promise<T>, slot = 1): Promise<T> {
  await ensureDuoSchema();
  const connection = await lockPool.connect();
  try {
    const { rows } = await connection.query("SELECT pg_try_advisory_lock(120120, $1) AS acquired", [id]);
    if (!rows[0]?.acquired) throw new Error("Entrega em processamento. Tente novamente em instantes.");
    const payment = (await connection.query<Payment>("SELECT * FROM payments WHERE id=$1", [id])).rows[0];
    if (!payment || payment.vip_tier !== "duo" || payment.status !== "approved") throw new Error("Pagamento não aprovado para este combo.");
    const redemption = (await connection.query<Redemption>("SELECT * FROM duo_redemptions WHERE payment_id=$1 AND slot=$2", [id,slot])).rows[0];
    return await run(payment, redemption);
  } finally {
    await connection.query("SELECT pg_advisory_unlock(120120, $1)", [id]).catch(() => {});
    connection.release();
  }
}
async function deliver(payment: Payment, discord: string, steam: string, slot = 0): Promise<void> {
  const client = discordClient();
  if (!client) throw new Error("Entrega indisponível no momento. Tente novamente em instantes.");
  const selection=((await storeOrder(payment.id))?.server_id||'solo-duo') as StoreSelection;
  await grantVipProduct({ paymentId: payment.id, discordUserId: discord, steamId: steam, deliveryServers:slot===2?['trio']:selectedServers(selection),
    tier: "duo", durationDays: 30, source: "purchase", client });
}
export async function fulfillDuoPayment(id: number): Promise<boolean> {
  return locked(id, async (payment, redemption) => {
    const selection=((await storeOrder(id))?.server_id||'solo-duo') as StoreSelection;
    const friendSlots=(await storeOrder(id))?.friend_slots??1;
    for(let slot=1;slot<=friendSlots;slot++) {
      if((await pool.query('SELECT 1 FROM duo_redemptions WHERE payment_id=$1 AND slot=$2',[id,slot])).rowCount)continue;
      const nonce = randomBytes(32).toString("hex");
      const token = duoToken(id, nonce);
      await pool.query(`INSERT INTO duo_redemptions(payment_id,nonce,token_hash,expires_at,slot)
        VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, [id, nonce, tokenHash(token), new Date(Date.now() + DUO_WINDOW_MS),slot]);
    }
    if (!payment.vip_granted_at) {
      await deliver(payment, payment.discord_user_id, payment.steam_id);
      await pool.query("UPDATE payments SET vip_granted_at=now(),updated_at=now() WHERE id=$1", [id]);
    }
    await recordStoreDelivery(id);
    return true;
  });
}
export async function listDuoPurchases(discord: string) {
  await ensureDuoSchema();
  const { rows } = await pool.query(`SELECT p.id,p.status AS payment_status,p.vip_granted_at,
    r.nonce,r.expires_at,r.status AS claim_status,r.redeemed_at,r.slot
    FROM payments p LEFT JOIN duo_redemptions r ON r.payment_id=p.id
    WHERE p.discord_user_id=$1 AND p.vip_tier='duo' ORDER BY p.created_at DESC LIMIT 30`, [discord]);
  const mapped=rows.map(row => ({ id: row.id, slot:row.slot, paymentStatus: row.payment_status,
    buyerStatus: row.vip_granted_at ? "delivered" : "pending", expiresAt: row.expires_at,
    claimStatus: row.claim_status === "available" && new Date(row.expires_at).getTime() <= Date.now() ? "expired" : row.claim_status,
    redeemedAt: row.redeemed_at,
    claimUrl: row.payment_status === "approved" && row.claim_status === "available" && new Date(row.expires_at).getTime() > Date.now()
      ? `https://www.guerrafriarust.com.br/api/store/duo/redeem#${duoToken(row.id, row.nonce)}` : null }));
  const groups=new Map<number,typeof mapped>();for(const row of mapped){const group=groups.get(row.id)||[];group.push(row);groups.set(row.id,group);}
  return [...groups.values()].map(group=>({...group.sort((a,b)=>a.slot-b.slot)[0],claimLinks:group.map(row=>({slot:row.slot,claimUrl:row.claimUrl,status:row.claimStatus,expiresAt:row.expiresAt}))}));
}
export async function inspectDuoToken(token: string) {
  await ensureDuoSchema();
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error("Link de resgate inválido.");
  const row = (await pool.query<Redemption & { payment_status: string }>(`SELECT r.*,p.status AS payment_status
    FROM duo_redemptions r JOIN payments p ON p.id=r.payment_id WHERE r.token_hash=$1`, [tokenHash(token)])).rows[0];
  if (!row || !tokenMatches(token, row.token_hash)) throw new Error("Link de resgate inválido.");
  if (row.payment_status !== "approved") throw new Error("Este pagamento não está aprovado. O resgate foi bloqueado.");
  return row;
}
export async function redeemDuo(token: string, discord: string, steam: string): Promise<void> {
  const found = await inspectDuoToken(token);
  return locked(found.payment_id, async (payment, row) => {
    if (!row || !tokenMatches(token, row.token_hash)) throw new Error("Link de resgate inválido.");
    const problem = claimProblem(row, payment.discord_user_id, payment.steam_id, discord, steam);
    if (problem) throw new Error(problem);
    const other=(await pool.query('SELECT 1 FROM duo_redemptions WHERE payment_id=$1 AND slot<>$2 AND (duo_discord_id=$3 OR duo_steam_id=$4)',[payment.id,row.slot,discord,steam])).rowCount;
    if(other)throw Error('Esta conta já está vinculada a outro convite desta compra.');
    await pool.query(`UPDATE duo_redemptions SET duo_discord_id=$2,duo_steam_id=$3,status='delivering'
      WHERE payment_id=$1 AND slot=$4`, [payment.id, discord, steam,row.slot]);
    await deliver(payment, discord, steam,row.slot);
    await pool.query("UPDATE duo_redemptions SET status='redeemed',redeemed_at=now() WHERE payment_id=$1 AND slot=$2", [payment.id,row.slot]);
  },found.slot);
}
export function startDuoReconciler(): void {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await ensureDuoSchema();
      const { rows } = await pool.query<Redemption>(`SELECT r.* FROM duo_redemptions r JOIN payments p ON p.id=r.payment_id
        WHERE r.status='delivering' AND p.status='approved' LIMIT 50`);
      for (const row of rows) {
        try { await redeemDuo(duoToken(row.payment_id, row.nonce), row.duo_discord_id!, row.duo_steam_id!); }
        catch (error) { logger.error({ error, paymentId: row.payment_id }, "Duo delivery will retry"); }
      }
    } catch (error) { logger.error({ error }, "Duo reconciliation failed"); }
    finally { running = false; }
  }, 30_000);
  timer.unref();
}

import { randomBytes } from "node:crypto";
import { pool, Pool } from "@workspace/db";
import { discordClient } from "../bot/client.js";
import { grantVipProduct } from "../bot/vipProducts.js";
import { logger } from "../lib/logger.js";
import { recordStoreDelivery } from "./storeReceipts.js";
import { claimProblem, DUO_WINDOW_MS, duoToken, tokenHash, tokenMatches } from "./duoPolicy.js";
import { storeOrder } from "./storeOrders.js";

type Payment = { id: number; discord_user_id: string; steam_id: string; status: string; vip_tier: string; vip_granted_at: Date | null };
type Redemption = { payment_id: number; slot: number; nonce: string; token_hash: string; expires_at: Date; status: string;
  duo_discord_id: string | null; duo_steam_id: string | null; redeemed_at: Date | null };
let ready: Promise<void> | undefined;
// Separate connections keep advisory locks from exhausting the delivery query pool.
const lockPool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4, connectionTimeoutMillis: 10_000 });
lockPool.on("error", error => logger.error({ error }, "Combo lock connection failed"));

export function ensureDuoSchema(): Promise<void> {
  return ready ??= pool.query(`CREATE TABLE IF NOT EXISTS duo_redemptions (
    payment_id INTEGER NOT NULL REFERENCES payments(id), slot SMALLINT NOT NULL DEFAULT 1,
    nonce TEXT NOT NULL, token_hash TEXT UNIQUE NOT NULL, expires_at TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','delivering','redeemed')),
    duo_discord_id TEXT, duo_steam_id TEXT, redeemed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY(payment_id,slot),
    CHECK (slot BETWEEN 1 AND 2),
    CHECK ((duo_discord_id IS NULL) = (duo_steam_id IS NULL))
  )`).then(async () => {
    // Migra compras antigas (1 link por pagamento) para o formato de vagas.
    await pool.query("ALTER TABLE duo_redemptions ADD COLUMN IF NOT EXISTS slot SMALLINT NOT NULL DEFAULT 1");
    await pool.query(`DO $$ BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid='duo_redemptions'::regclass AND conname='duo_redemptions_pkey' AND cardinality(conkey)=1
      ) THEN
        ALTER TABLE duo_redemptions DROP CONSTRAINT duo_redemptions_pkey;
        ALTER TABLE duo_redemptions ADD CONSTRAINT duo_redemptions_pkey PRIMARY KEY(payment_id,slot);
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conrelid='duo_redemptions'::regclass AND conname='duo_redemptions_slot_check'
      ) THEN
        ALTER TABLE duo_redemptions ADD CONSTRAINT duo_redemptions_slot_check CHECK(slot BETWEEN 1 AND 2);
      END IF;
    END $$;`);
    await pool.query("ALTER TABLE vip_subscriptions ALTER COLUMN source TYPE VARCHAR(64)");
  }).catch(error => { ready = undefined; throw error; });
}

async function redemptionSlots(paymentId: number): Promise<1 | 2> {
  const order = await storeOrder(paymentId);
  return order?.server_id === "trio" ? 2 : 1;
}

// Session advisory locks serialize external RCON delivery across instances. The
// association is committed before side effects; crashes cannot free a used link.
async function locked<T>(id: number, run: (payment: Payment, redemptions: Redemption[]) => Promise<T>): Promise<T> {
  await ensureDuoSchema();
  const connection = await lockPool.connect();
  try {
    const { rows } = await connection.query("SELECT pg_try_advisory_lock(120120, $1) AS acquired", [id]);
    if (!rows[0]?.acquired) throw new Error("Entrega em processamento. Tente novamente em instantes.");
    const payment = (await connection.query<Payment>("SELECT * FROM payments WHERE id=$1", [id])).rows[0];
    if (!payment || payment.vip_tier !== "duo" || payment.status !== "approved") throw new Error("Pagamento não aprovado para este combo.");
    const redemptions = (await connection.query<Redemption>("SELECT * FROM duo_redemptions WHERE payment_id=$1 ORDER BY slot", [id])).rows;
    return await run(payment, redemptions);
  } finally {
    await connection.query("SELECT pg_advisory_unlock(120120, $1)", [id]).catch(() => {});
    connection.release();
  }
}

async function deliver(payment: Payment, discord: string, steam: string): Promise<void> {
  const client = discordClient();
  if (!client) throw new Error("Entrega indisponível no momento. Tente novamente em instantes.");
  await grantVipProduct({ paymentId: payment.id, discordUserId: discord, steamId: steam,
    tier: "duo", durationDays: 30, source: "purchase", client });
}

export async function fulfillDuoPayment(id: number): Promise<boolean> {
  return locked(id, async (payment, redemptions) => {
    const slots = await redemptionSlots(id);
    for (let slot = 1; slot <= slots; slot++) {
      if (redemptions.some(row => row.slot === slot)) continue;
      const nonce = randomBytes(32).toString("hex");
      const token = duoToken(id, nonce);
      await pool.query(`INSERT INTO duo_redemptions(payment_id,slot,nonce,token_hash,expires_at)
        VALUES($1,$2,$3,$4,$5) ON CONFLICT(payment_id,slot) DO NOTHING`,
        [id, slot, nonce, tokenHash(token), new Date(Date.now() + DUO_WINDOW_MS)]);
    }
    if (!payment.vip_granted_at) {
      await deliver(payment, payment.discord_user_id, payment.steam_id);
      await pool.query("UPDATE payments SET vip_granted_at=now(),updated_at=now() WHERE id=$1", [id]);
    }
    await recordStoreDelivery(id);
    return true;
  });
}

type PurchaseClaim = {
  slot: number;
  status: string;
  expiresAt: Date;
  redeemedAt: Date | null;
  claimUrl: string | null;
};

export async function listDuoPurchases(discord: string) {
  await ensureDuoSchema();
  const { rows } = await pool.query(`SELECT p.id,p.status AS payment_status,p.vip_granted_at,p.created_at,
    o.server_id,r.slot,r.nonce,r.expires_at,r.status AS claim_status,r.redeemed_at
    FROM payments p
    LEFT JOIN store_orders o ON o.payment_id=p.id
    LEFT JOIN duo_redemptions r ON r.payment_id=p.id
    WHERE p.discord_user_id=$1 AND p.vip_tier='duo'
    ORDER BY p.created_at DESC,r.slot ASC LIMIT 90`, [discord]);

  const purchases = new Map<number, {
    id:number; paymentStatus:string; buyerStatus:string; serverId:string; claims:PurchaseClaim[];
  }>();
  for (const row of rows) {
    let purchase = purchases.get(row.id);
    if (!purchase) {
      purchase = { id:row.id, paymentStatus:row.payment_status,
        buyerStatus:row.vip_granted_at ? "delivered" : "pending",
        serverId:row.server_id === "trio" ? "trio" : "solo-duo", claims:[] };
      purchases.set(row.id, purchase);
    }
    if (!row.slot || !row.nonce || !row.expires_at) continue;
    const expired = row.claim_status === "available" && new Date(row.expires_at).getTime() <= Date.now();
    const status = expired ? "expired" : row.claim_status;
    const claimUrl = row.payment_status === "approved" && status === "available"
      ? `https://www.guerrafriarust.com.br/api/store/duo/redeem#${duoToken(row.id, row.nonce)}` : null;
    purchase.claims.push({ slot:Number(row.slot), status, expiresAt:row.expires_at, redeemedAt:row.redeemed_at, claimUrl });
  }

  return [...purchases.values()].map(purchase => {
    const available = purchase.claims.filter(claim => claim.claimUrl);
    const overall = purchase.claims.some(claim => claim.status === "delivering") ? "delivering"
      : purchase.claims.length && purchase.claims.every(claim => claim.status === "redeemed") ? "redeemed"
      : available.length ? "available"
      : purchase.claims.length && purchase.claims.every(claim => claim.status === "expired") ? "expired"
      : "pending";
    return {
      ...purchase,
      comboName: purchase.serverId === "trio" ? "Super Combo Trio" : "Super Combo Duo",
      claimStatus: overall,
      claimUrl: available[0]?.claimUrl ?? null,
      claimUrls: available.map(claim => claim.claimUrl!),
      expiresAt: purchase.claims[0]?.expiresAt ?? null,
      redeemedAt: purchase.claims.filter(claim => claim.redeemedAt).map(claim => claim.redeemedAt),
    };
  });
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
  return locked(found.payment_id, async (payment, rows) => {
    const row = rows.find(candidate => candidate.slot === found.slot);
    if (!row || !tokenMatches(token, row.token_hash)) throw new Error("Link de resgate inválido.");
    const problem = claimProblem(row, payment.discord_user_id, payment.steam_id, discord, steam);
    if (problem) throw new Error(problem);
    const duplicate = rows.find(candidate => candidate.slot !== row.slot &&
      (candidate.duo_discord_id === discord || candidate.duo_steam_id === steam));
    if (duplicate) throw new Error("Esta conta já resgatou uma vaga deste combo.");
    await pool.query(`UPDATE duo_redemptions SET duo_discord_id=$3,duo_steam_id=$4,status='delivering'
      WHERE payment_id=$1 AND slot=$2`, [payment.id, row.slot, discord, steam]);
    await deliver(payment, discord, steam);
    await pool.query("UPDATE duo_redemptions SET status='redeemed',redeemed_at=now() WHERE payment_id=$1 AND slot=$2", [payment.id, row.slot]);
  });
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
        catch (error) { logger.error({ error, paymentId: row.payment_id, slot: row.slot }, "Combo delivery will retry"); }
      }
    } catch (error) { logger.error({ error }, "Combo reconciliation failed"); }
    finally { running = false; }
  }, 30_000);
  timer.unref();
}

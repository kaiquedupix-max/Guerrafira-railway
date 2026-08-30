import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { sendSeasonRegistrationConfirmations } from "./seasonConfirmations.js";

const OFFICIAL_KEY = 101;
const MP_BASE = "https://api.mercadopago.com";
let started = false;
let running = false;

function token(): string | null {
  return process.env.MP_ACCESS_TOKEN?.trim() || null;
}

async function mpGet(path: string): Promise<any | null> {
  const accessToken = token();
  if (!accessToken) return null;
  try {
    const r = await fetch(`${MP_BASE}${path}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!r.ok) {
      logger.warn({ status: r.status, path }, "Season Mercado Pago lookup failed");
      return null;
    }
    return await r.json();
  } catch (error) {
    logger.error({ error, path }, "Season Mercado Pago lookup error");
    return null;
  }
}

async function fetchPayment(id: string): Promise<any | null> {
  return mpGet(`/v1/payments/${encodeURIComponent(id)}`);
}

async function fetchPreferencePayments(preferenceId: string): Promise<any[]> {
  const order = await mpGet(`/merchant_orders/search?preference_id=${encodeURIComponent(preferenceId)}`);
  const ids = (order?.elements ?? []).flatMap((x: any) => x?.payments ?? [])
    .map((x: any) => String(x?.id ?? "")).filter(Boolean);
  const items = await Promise.all(ids.map(fetchPayment));
  return items.filter(Boolean);
}

function validSeasonPayment(payment: any, discordId: string): boolean {
  if (!payment || String(payment.status) !== "approved") return false;
  const amount = Number(payment.transaction_amount ?? 0);
  if (!Number.isFinite(amount) || amount < 20) return false;
  const metadata = payment.metadata ?? {};
  const metadataDiscord = String(metadata.discord_user_id ?? "");
  const tier = String(metadata.vip_tier ?? "");
  if (metadataDiscord && metadataDiscord !== discordId) return false;
  if (tier && tier !== "season1_entry") return false;
  return true;
}

async function activate(discordId: string, payment: any): Promise<void> {
  const paymentId = String(payment.id ?? "");
  if (!paymentId) return;

  const result: any = await db.execute(sql`
    UPDATE season_official_registrations
       SET status='active',
           entry_type='paid',
           amount=20,
           mp_payment_id=${paymentId},
           paid_at=COALESCE(paid_at, now()),
           updated_at=now()
     WHERE season_key=${OFFICIAL_KEY}
       AND discord_id=${discordId}
       AND status <> 'active'
     RETURNING discord_id
  `);

  if (!result?.rows?.length) return;

  logger.info({ discordId, paymentId }, "Season paid registration activated by reconciler");
  try {
    await sendSeasonRegistrationConfirmations(discordId);
  } catch (error) {
    logger.error({ error, discordId, paymentId }, "Season confirmation delivery failed after activation");
  }
}

async function reconcile(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const result: any = await db.execute(sql`
      SELECT discord_id, mp_payment_id, mp_preference_id
        FROM season_official_registrations
       WHERE season_key=${OFFICIAL_KEY}
         AND entry_type='paid'
         AND status IN ('pending','in_process')
         AND (mp_payment_id IS NOT NULL OR mp_preference_id IS NOT NULL)
       ORDER BY updated_at DESC
       LIMIT 100
    `);

    for (const row of result?.rows ?? []) {
      const discordId = String(row.discord_id ?? "");
      if (!discordId) continue;

      let candidates: any[] = [];
      if (row.mp_payment_id) {
        const p = await fetchPayment(String(row.mp_payment_id));
        if (p) candidates = [p];
      }
      if (!candidates.length && row.mp_preference_id) {
        candidates = await fetchPreferencePayments(String(row.mp_preference_id));
      }

      const approved = candidates.find(p => validSeasonPayment(p, discordId));
      if (approved) await activate(discordId, approved);
    }
  } catch (error) {
    logger.error({ error }, "Season payment reconciliation failed");
  } finally {
    running = false;
  }
}

export function startSeasonPaymentReconciler(): void {
  if (started) return;
  started = true;
  setTimeout(() => void reconcile(), 5_000);
  setInterval(() => void reconcile(), 20_000);
}

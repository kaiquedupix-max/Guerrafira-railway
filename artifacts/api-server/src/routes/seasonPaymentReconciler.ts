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

async function fetchRecentApprovedPayments(): Promise<any[]> {
  const data = await mpGet(`/v1/payments/search?sort=date_created&criteria=desc&status=approved&limit=100`);
  return Array.isArray(data?.results) ? data.results : [];
}

function amountIsSeasonEntry(payment: any): boolean {
  const amount = Number(payment?.transaction_amount ?? 0);
  return String(payment?.status) === "approved" && Number.isFinite(amount) && amount >= 19.99 && amount <= 20.01;
}

function validSeasonPayment(payment: any, discordId: string): boolean {
  if (!amountIsSeasonEntry(payment)) return false;
  const metadata = payment.metadata ?? {};
  const metadataDiscord = String(metadata.discord_user_id ?? "");
  const tier = String(metadata.vip_tier ?? "");
  if (metadataDiscord && metadataDiscord !== discordId) return false;
  if (tier && tier !== "season1_entry") return false;
  return true;
}

function validRecoveredPayment(payment: any, row: any): boolean {
  if (!amountIsSeasonEntry(payment)) return false;

  const discordId = String(row.discord_id ?? "");
  const metadata = payment?.metadata ?? {};
  const metadataDiscord = String(metadata.discord_user_id ?? "");
  const tier = String(metadata.vip_tier ?? "");
  const externalReference = String(payment?.external_reference ?? "");

  if (metadataDiscord === discordId && (!tier || tier === "season1_entry")) return true;
  if (externalReference.startsWith(`${discordId}-season1_entry-`)) return true;

  const registrationEmail = String(row.contact_email ?? "").trim().toLowerCase();
  const payerEmail = String(payment?.payer?.email ?? "").trim().toLowerCase();
  const description = String(payment?.description ?? "").toLowerCase();
  if (!registrationEmail || payerEmail !== registrationEmail || !description.includes("season")) return false;

  const registrationTime = new Date(row.created_at ?? 0).getTime();
  const paymentTime = new Date(payment?.date_created ?? 0).getTime();
  if (!Number.isFinite(registrationTime) || !Number.isFinite(paymentTime)) return true;
  return paymentTime >= registrationTime - 10 * 60_000;
}

async function activate(discordId: string, payment: any, recovered = false): Promise<boolean> {
  const paymentId = String(payment.id ?? "");
  if (!paymentId) return false;

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

  if (!result?.rows?.length) return false;

  logger.info({ discordId, paymentId, recovered }, "Season paid registration activated by reconciler");
  try {
    await sendSeasonRegistrationConfirmations(discordId);
  } catch (error) {
    logger.error({ error, discordId, paymentId }, "Season confirmation delivery failed after activation");
  }
  return true;
}

async function reconcile(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const result: any = await db.execute(sql`
      SELECT discord_id, contact_email, created_at, mp_payment_id, mp_preference_id
        FROM season_official_registrations
       WHERE season_key=${OFFICIAL_KEY}
         AND entry_type='paid'
         AND status IN ('pending','in_process')
       ORDER BY updated_at DESC
       LIMIT 100
    `);

    const rows = result?.rows ?? [];
    if (!rows.length) return;

    let recentApproved: any[] | null = null;
    let activated = 0;

    for (const row of rows) {
      const discordId = String(row.discord_id ?? "");
      if (!discordId) continue;

      let candidates: any[] = [];
      if (row.mp_payment_id) {
        const p = await fetchPayment(String(row.mp_payment_id));
        if (p) candidates = [p];
      }
      if (!candidates.some(p => validSeasonPayment(p, discordId)) && row.mp_preference_id) {
        candidates.push(...await fetchPreferencePayments(String(row.mp_preference_id)));
      }

      const approved = candidates.find(p => validSeasonPayment(p, discordId));
      if (approved) {
        if (await activate(discordId, approved)) activated++;
        continue;
      }

      if (recentApproved === null) recentApproved = await fetchRecentApprovedPayments();
      const recovered = recentApproved.find(p => validRecoveredPayment(p, row));
      if (recovered && await activate(discordId, recovered, true)) activated++;
    }

    logger.info({ pendingChecked: rows.length, activated, fallbackPayments: recentApproved?.length ?? 0 }, "Season payment reconciliation cycle completed");
  } catch (error) {
    logger.error({ error }, "Season payment reconciliation failed");
  } finally {
    running = false;
  }
}

export function startSeasonPaymentReconciler(): void {
  if (started) return;
  started = true;
  logger.info("Season payment reconciler started");
  setTimeout(() => void reconcile(), 2_000);
  setInterval(() => void reconcile(), 20_000);
}

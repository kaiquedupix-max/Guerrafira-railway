import { and, desc, eq, gt, inArray, isNotNull, isNull } from "drizzle-orm";
import { db, paymentsTable, vipSubscriptionsTable } from "@workspace/db";
import { discordClient } from "../bot/client.js";
import { grantVip, type VipTier } from "../bot/vip.js";
import { retrieveStripeCheckout, type StripeCheckoutSession } from "../bot/stripe.js";
import { logger } from "../lib/logger.js";

type PaymentRow = typeof paymentsTable.$inferSelect;
let reconciliationStarted = false;
let reconciliationRunning = false;

function paymentIntentId(session: StripeCheckoutSession): string {
  if (typeof session.payment_intent === "string") return session.payment_intent;
  return session.payment_intent?.id ? String(session.payment_intent.id) : "";
}

async function findStripePaymentRow(session: StripeCheckoutSession): Promise<PaymentRow | null> {
  if (session.id) {
    const [bySession] = await db.select().from(paymentsTable)
      .where(eq(paymentsTable.stripeSessionId, session.id)).limit(1);
    if (bySession) return bySession;
  }

  const rowId = Number(session.client_reference_id ?? session.metadata?.payment_row_id ?? "");
  if (Number.isInteger(rowId) && rowId > 0) {
    const [byId] = await db.select().from(paymentsTable).where(eq(paymentsTable.id, rowId)).limit(1);
    if (byId?.method === "stripe_card") return byId;
  }
  return null;
}

function matchesPurchase(row: PaymentRow, session: StripeCheckoutSession): boolean {
  if (row.method !== "stripe_card") return false;
  if (row.stripeSessionId && row.stripeSessionId !== session.id) return false;
  if ((session.currency ?? "").toLowerCase() !== "brl") return false;
  if (session.amount_total !== Math.round(Number(row.amount) * 100)) return false;

  const metadata = session.metadata ?? {};
  if (metadata.payment_row_id && metadata.payment_row_id !== String(row.id)) return false;
  if (metadata.discord_user_id && metadata.discord_user_id !== row.discordUserId) return false;
  if (metadata.steam_id && metadata.steam_id !== (row.steamId ?? "")) return false;
  if (metadata.vip_tier && metadata.vip_tier !== row.vipTier) return false;
  return true;
}

async function notifyTicket(row: PaymentRow, content: string): Promise<void> {
  if (!row.ticketChannelId) return;
  const client = discordClient();
  if (!client) return;
  const channel = await client.channels.fetch(row.ticketChannelId).catch(() => null);
  if (channel?.isSendable()) await channel.send(content).catch(() => {});
}

async function fulfillStripePayment(row: PaymentRow, session: StripeCheckoutSession): Promise<boolean> {
  if (row.vipGrantedAt) return true;

  const [existingFulfillment] = await db.select().from(vipSubscriptionsTable).where(and(
    eq(vipSubscriptionsTable.steamId, row.steamId ?? ""),
    eq(vipSubscriptionsTable.vipTier, row.vipTier),
    gt(vipSubscriptionsTable.createdAt, row.createdAt),
  )).orderBy(desc(vipSubscriptionsTable.createdAt)).limit(1);

  if (existingFulfillment) {
    await db.update(paymentsTable).set({
      vipGrantedAt: existingFulfillment.createdAt,
      updatedAt: new Date(),
    }).where(eq(paymentsTable.id, row.id));
    logger.info({ sessionId: session.id, rowId: row.id }, "Approved Stripe payment already fulfilled manually");
    return true;
  }

  const claimedAt = new Date();
  const [claimed] = await db.update(paymentsTable).set({
    vipGrantedAt: claimedAt,
    updatedAt: claimedAt,
  }).where(and(eq(paymentsTable.id, row.id), isNull(paymentsTable.vipGrantedAt))).returning();
  if (!claimed) return true;

  const steamId = row.steamId ?? "";
  const discordUserId = row.discordUserId;
  const vipTier = row.vipTier as VipTier;
  const client = discordClient();

  if (!client || !steamId || !discordUserId || !["bronze", "prata", "ouro"].includes(vipTier)) {
    await db.update(paymentsTable).set({ vipGrantedAt: null, updatedAt: new Date() })
      .where(eq(paymentsTable.id, row.id));
    logger.error({ rowId: row.id, client: Boolean(client), steamId, discordUserId, vipTier },
      "Approved Stripe payment could not grant VIP");
    return false;
  }

  try {
    await grantVip({
      discordUserId,
      steamId,
      tier: vipTier,
      durationDays: 30,
      source: "purchase",
      client,
    });
    await notifyTicket(row,
      `✅ **Pagamento Stripe aprovado!** Seu **VIP ${vipTier}** foi ativado.\n🎮 [Abrir perfil Steam](https://steamcommunity.com/profiles/${steamId}) • 📅 Válido por **30 dias**. Obrigado! 🙌`,
    );
    logger.info({ sessionId: session.id, rowId: row.id, vipTier, steamId }, "Approved Stripe payment fulfilled");
    return true;
  } catch (err) {
    await db.update(paymentsTable).set({ vipGrantedAt: null, updatedAt: new Date() })
      .where(eq(paymentsTable.id, row.id));
    logger.error({ err, sessionId: session.id, rowId: row.id }, "Stripe VIP grant failed; payment left ready for retry");
    return false;
  }
}

export async function processStripeCheckoutSession(session: StripeCheckoutSession): Promise<boolean> {
  const row = await findStripePaymentRow(session);
  if (!row) {
    logger.warn({ sessionId: session.id, clientReferenceId: session.client_reference_id }, "Stripe payment record not found");
    return false;
  }
  if (!matchesPurchase(row, session)) {
    logger.error({ sessionId: session.id, rowId: row.id, amountTotal: session.amount_total, currency: session.currency },
      "Stripe checkout did not match the internal purchase record");
    return false;
  }

  const paid = session.payment_status === "paid";
  const status = paid ? "approved" : session.status === "expired" ? "expired" : "pending";
  await db.update(paymentsTable).set({
    stripeSessionId: session.id,
    stripePaymentIntentId: paymentIntentId(session) || row.stripePaymentIntentId,
    status,
    updatedAt: new Date(),
  }).where(eq(paymentsTable.id, row.id));

  if (!paid) return true;
  const refreshed: PaymentRow = {
    ...row,
    stripeSessionId: session.id,
    stripePaymentIntentId: paymentIntentId(session) || row.stripePaymentIntentId,
    status: "approved",
    updatedAt: new Date(),
  };
  return fulfillStripePayment(refreshed, session);
}

async function reconcilePendingStripePayments(): Promise<void> {
  if (reconciliationRunning) return;
  reconciliationRunning = true;
  try {
    const pending = await db.select().from(paymentsTable).where(and(
      eq(paymentsTable.method, "stripe_card"),
      inArray(paymentsTable.status, ["pending", "approved"]),
      isNull(paymentsTable.vipGrantedAt),
      isNotNull(paymentsTable.stripeSessionId),
    )).orderBy(desc(paymentsTable.createdAt)).limit(100);

    for (const row of pending) {
      if (!row.stripeSessionId) continue;
      const session = await retrieveStripeCheckout(row.stripeSessionId);
      if (session) await processStripeCheckoutSession(session);
    }
  } finally {
    reconciliationRunning = false;
  }
}

export function startStripePaymentReconciler(): void {
  if (reconciliationStarted) return;
  reconciliationStarted = true;
  setTimeout(() => reconcilePendingStripePayments().catch(err =>
    logger.error({ err }, "Initial Stripe payment reconciliation failed")), 12_000);
  setInterval(() => reconcilePendingStripePayments().catch(err =>
    logger.error({ err }, "Stripe payment reconciliation failed")), 30_000);
}

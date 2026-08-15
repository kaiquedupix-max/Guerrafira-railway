import { and, desc, eq, gt, inArray, isNull } from "drizzle-orm";
import { db, paymentsTable, vipSubscriptionsTable } from "@workspace/db";
import { grantVip, type VipTier } from "../bot/vip.js";
import { discordClient } from "../bot/client.js";
import { logger } from "../lib/logger.js";

type PaymentRow = typeof paymentsTable.$inferSelect;
type MpPayment = Record<string, unknown>;

const MP_BASE = "https://api.mercadopago.com";
let reconciliationStarted = false;
let reconciliationRunning = false;

function token(): string | null {
  const value = process.env.MP_ACCESS_TOKEN?.trim();
  if (!value) logger.error("MP_ACCESS_TOKEN não configurado — pagamentos não podem ser conciliados");
  return value || null;
}

async function mpGet(path: string): Promise<unknown | null> {
  const accessToken = token();
  if (!accessToken) return null;
  const response = await fetch(`${MP_BASE}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    logger.error({ status: response.status, path }, "Mercado Pago consultation failed");
    return null;
  }
  return response.json() as Promise<unknown>;
}

export async function fetchMpPayment(paymentId: string): Promise<MpPayment | null> {
  const data = await mpGet(`/v1/payments/${encodeURIComponent(paymentId)}`);
  return data && typeof data === "object" ? data as MpPayment : null;
}

async function findByExternalReference(externalReference: string): Promise<MpPayment[]> {
  const data = await mpGet(
    `/v1/payments/search?sort=date_created&criteria=desc&external_reference=${encodeURIComponent(externalReference)}`,
  ) as { results?: MpPayment[] } | null;
  return Array.isArray(data?.results) ? data.results : [];
}

async function findByPreference(preferenceId: string): Promise<MpPayment[]> {
  const data = await mpGet(
    `/merchant_orders/search?preference_id=${encodeURIComponent(preferenceId)}`,
  ) as { elements?: Array<{ payments?: Array<{ id?: number | string }> }> } | null;
  const ids = (data?.elements ?? []).flatMap(order => order.payments ?? [])
    .map(payment => String(payment.id ?? "")).filter(Boolean);
  const payments = await Promise.all(ids.map(fetchMpPayment));
  return payments.filter((payment): payment is MpPayment => Boolean(payment));
}

async function findRecord(payment: MpPayment): Promise<PaymentRow | null> {
  const paymentId = String(payment.id ?? "");
  const preferenceId = String(payment.preference_id ?? "");
  const externalReference = String(payment.external_reference ?? "");
  const metadata = (payment.metadata ?? {}) as Record<string, unknown>;

  if (paymentId) {
    const [row] = await db.select().from(paymentsTable)
      .where(eq(paymentsTable.mpPaymentId, paymentId)).limit(1);
    if (row) return row;
  }
  if (preferenceId) {
    const [row] = await db.select().from(paymentsTable)
      .where(eq(paymentsTable.mpPreferenceId, preferenceId)).limit(1);
    if (row) return row;
  }
  if (externalReference) {
    const [row] = await db.select().from(paymentsTable)
      .where(eq(paymentsTable.mpExternalReference, externalReference)).limit(1);
    if (row) return row;
  }

  const discordUserId = String(metadata.discord_user_id ?? "");
  const steamId = String(metadata.steam_id ?? "");
  const vipTier = String(metadata.vip_tier ?? "");
  if (discordUserId && steamId && vipTier) {
    const [row] = await db.select().from(paymentsTable).where(and(
      eq(paymentsTable.discordUserId, discordUserId),
      eq(paymentsTable.steamId, steamId),
      eq(paymentsTable.vipTier, vipTier),
      inArray(paymentsTable.status, ["pending", "in_process"]),
    )).orderBy(desc(paymentsTable.createdAt)).limit(1);
    if (row) return row;
  }
  return null;
}

async function notifyTicket(row: PaymentRow, content: string): Promise<void> {
  if (!row.ticketChannelId) return;
  const client = discordClient();
  if (!client) return;
  const channel = await client.channels.fetch(row.ticketChannelId).catch(() => null);
  if (channel?.isSendable()) await channel.send(content).catch(() => {});
}

export async function processMpPayment(payment: MpPayment): Promise<boolean> {
  const row = await findRecord(payment);
  const paymentId = String(payment.id ?? "");
  const preferenceId = String(payment.preference_id ?? "");
  const externalReference = String(payment.external_reference ?? "");
  const status = String(payment.status ?? "pending");

  if (!row) {
    logger.warn({ paymentId, preferenceId, externalReference, status }, "Payment record not found");
    return false;
  }

  await db.update(paymentsTable).set({
    mpPaymentId: paymentId || row.mpPaymentId,
    mpPreferenceId: preferenceId || row.mpPreferenceId,
    mpExternalReference: externalReference || row.mpExternalReference,
    status,
    updatedAt: new Date(),
  }).where(eq(paymentsTable.id, row.id));

  if (status !== "approved") {
    if (status === "rejected" || status === "cancelled") {
      await notifyTicket(row,
        `❌ Pagamento **${status === "rejected" ? "recusado" : "cancelado"}**. Tente novamente ou escolha outro método.`,
      );
    }
    return true;
  }

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
    logger.info({ paymentId, rowId: row.id }, "Approved card payment already fulfilled manually");
    return true;
  }

  const claimedAt = new Date();
  const [claimed] = await db.update(paymentsTable).set({
    vipGrantedAt: claimedAt,
    updatedAt: claimedAt,
  }).where(and(eq(paymentsTable.id, row.id), isNull(paymentsTable.vipGrantedAt))).returning();

  if (!claimed) return true;

  const metadata = (payment.metadata ?? {}) as Record<string, unknown>;
  const steamId = row.steamId || String(metadata.steam_id ?? "");
  const discordUserId = row.discordUserId || String(metadata.discord_user_id ?? "");
  const vipTier = (row.vipTier || String(metadata.vip_tier ?? "")) as VipTier;
  const client = discordClient();

  if (!client || !steamId || !discordUserId || !["bronze", "prata", "ouro"].includes(vipTier)) {
    await db.update(paymentsTable).set({ vipGrantedAt: null, updatedAt: new Date() })
      .where(eq(paymentsTable.id, row.id));
    logger.error({ rowId: row.id, client: Boolean(client), steamId, discordUserId, vipTier },
      "Approved payment could not grant VIP");
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
      `✅ **Pagamento aprovado!** Seu **VIP ${vipTier}** foi ativado.\n🎮 [Abrir perfil Steam](https://steamcommunity.com/profiles/${steamId}) • 📅 Válido por **30 dias**. Obrigado! 🙌`,
    );
    logger.info({ paymentId, rowId: row.id, vipTier, steamId }, "Approved payment fulfilled");
    return true;
  } catch (err) {
    await db.update(paymentsTable).set({ vipGrantedAt: null, updatedAt: new Date() })
      .where(eq(paymentsTable.id, row.id));
    logger.error({ err, paymentId, rowId: row.id }, "VIP grant failed; payment left ready for retry");
    return false;
  }
}

async function reconcilePendingPayments(): Promise<void> {
  if (reconciliationRunning) return;
  reconciliationRunning = true;
  try {
    const pending = await db.select().from(paymentsTable).where(and(
      inArray(paymentsTable.status, ["pending", "in_process", "approved"]),
      isNull(paymentsTable.vipGrantedAt),
    )).orderBy(desc(paymentsTable.createdAt)).limit(150);

    for (const row of pending) {
      let candidates: MpPayment[] = [];
      if (row.mpPaymentId) {
        const direct = await fetchMpPayment(row.mpPaymentId);
        if (direct) candidates = [direct];
      }
      if (!candidates.length && row.mpExternalReference) candidates = await findByExternalReference(row.mpExternalReference);
      if (!candidates.length && row.mpPreferenceId) candidates = await findByPreference(row.mpPreferenceId);
      const approved = candidates.find(payment => String(payment.status) === "approved");
      const newest = approved ?? candidates[0];
      if (newest) await processMpPayment(newest);
    }
  } finally {
    reconciliationRunning = false;
  }
}

export function startCardPaymentReconciler(): void {
  if (reconciliationStarted) return;
  reconciliationStarted = true;
  setTimeout(() => reconcilePendingPayments().catch(err =>
    logger.error({ err }, "Initial payment reconciliation failed")), 15_000);
  setInterval(() => reconcilePendingPayments().catch(err =>
    logger.error({ err }, "Payment reconciliation failed")), 30_000);
}

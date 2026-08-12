/**
 * Mercado Pago payment webhook handler.
 * MP sends POST /webhook/mercadopago when a payment status changes.
 */

import { Router, type Request, type Response } from "express";
import { eq, or } from "drizzle-orm";
import { db, paymentsTable } from "@workspace/db";
import { grantVip, type VipTier } from "../bot/vip.js";
import { discordClient } from "../bot/client.js";
import { logger } from "../lib/logger.js";

const router = Router();

async function fetchMpPayment(paymentId: string): Promise<Record<string, unknown> | null> {
  const token = process.env.MP_ACCESS_TOKEN;
  if (!token) return null;
  const res = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    logger.error({ status: res.status, paymentId }, "Failed to fetch MP payment details");
    return null;
  }
  return res.json() as Promise<Record<string, unknown>>;
}

router.post("/mercadopago", async (req: Request, res: Response) => {
  // Acknowledge immediately to prevent MP retries
  res.status(200).json({ received: true });

  const body = req.body as Record<string, unknown>;
  logger.info({ body: JSON.stringify(body).slice(0, 500) }, "MP webhook received");

  try {
    const type   = body.type   as string | undefined;
    const action = body.action as string | undefined;
    const dataId = (body.data as Record<string, unknown> | undefined)?.id as string | undefined;

    // Accept both old (type=payment) and new (action=payment.*) formats
    const isPaymentNotification =
      type === "payment" || (typeof action === "string" && action.startsWith("payment."));

    if (!isPaymentNotification || !dataId) {
      logger.info({ type, action, dataId }, "Webhook ignored (not a payment notification)");
      return;
    }

    const mpData = await fetchMpPayment(dataId);
    if (!mpData) return;

    const status   = mpData.status as string;
    const mpPayId  = String(mpData.id);
    const metadata = (mpData.metadata ?? {}) as Record<string, string>;

    // preference_id is present on card payments
    const mpPrefId = (mpData.preference_id as string | undefined) ?? "";

    logger.info({ mpPayId, status, mpPrefId, metadata }, "MP payment details fetched");

    // ── Find matching DB record ─────────────────────────────────────────────
    let rec = await db.select().from(paymentsTable).where(eq(paymentsTable.mpPaymentId, mpPayId)).then((r) => r[0]);

    if (!rec && mpPrefId) {
      rec = await db.select().from(paymentsTable).where(eq(paymentsTable.mpPreferenceId, mpPrefId)).then((r) => r[0]);
    }

    if (!rec) {
      logger.warn({ mpPayId, mpPrefId, status }, "Payment record not found in DB — cannot process");
      return;
    }

    logger.info({ recId: rec.id, tier: rec.vipTier, discordUserId: rec.discordUserId, steamId: rec.steamId }, "DB payment record found");

    // ── Update status ────────────────────────────────────────────────────────
    await db.update(paymentsTable).set({ status, updatedAt: new Date() }).where(eq(paymentsTable.id, rec.id));

    // ── Handle approved ──────────────────────────────────────────────────────
    if (status === "approved") {
      // Prefer DB record data; fall back to payment metadata
      const steamId       = rec.steamId ?? metadata.steam_id ?? "";
      const discordUserId = rec.discordUserId ?? metadata.discord_user_id ?? "";
      const vipTier       = (rec.vipTier ?? metadata.vip_tier ?? "") as VipTier;

      if (!steamId || !discordUserId || !vipTier) {
        logger.error({ rec, metadata }, "Missing required fields for VIP grant");
        return;
      }

      const client = discordClient();
      if (!client) {
        logger.error("Discord client not available — cannot grant VIP");
        return;
      }

      await grantVip({ discordUserId, steamId, tier: vipTier, durationDays: 30, source: "purchase", client });

      // Notify in ticket channel
      if (rec.ticketChannelId) {
        const ch = await client.channels.fetch(rec.ticketChannelId).catch(() => null);
        if (ch?.isSendable()) {
          await ch.send(
            `✅ **Pagamento aprovado!** Seu **VIP ${vipTier}** foi ativado.\n` +
            `🎮 Steam ID: \`${steamId}\`  •  📅 Válido por **30 dias**. Obrigado! 🙌`,
          );
        }
      }
    } else if (status === "rejected" || status === "cancelled") {
      const client = discordClient();
      if (rec.ticketChannelId && client) {
        const ch = await client.channels.fetch(rec.ticketChannelId).catch(() => null);
        if (ch?.isSendable()) {
          await ch.send(`❌ Pagamento **${status === "rejected" ? "recusado" : "cancelado"}**. Tente novamente ou escolha outro método.`);
        }
      }
    } else {
      logger.info({ status, mpPayId }, "Payment status not actionable yet");
    }
  } catch (err) {
    logger.error({ err }, "Webhook processing error");
  }
});

export default router;

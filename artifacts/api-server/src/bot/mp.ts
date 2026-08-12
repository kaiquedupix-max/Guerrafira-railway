/** Mercado Pago API helpers — PIX and card checkout. Produção apenas. */

import { logger } from "../lib/logger.js";

const MP_BASE = "https://api.mercadopago.com";

function getToken(): string | null {
  const token = process.env.MP_ACCESS_TOKEN;
  if (!token) logger.warn("MP_ACCESS_TOKEN not set — payments disabled");
  return token ?? null;
}

function getWebhookUrl(): string {
  const rawDomain =
    process.env.RAILWAY_PUBLIC_DOMAIN ??
    process.env.APP_DOMAIN ??
    process.env.REPLIT_DEV_DOMAIN ??
    "";

  const domain = rawDomain.trim().replace(/^https?:\/\//i, "").replace(/\/$/, "");
  if (!domain) {
    logger.warn("Public domain not set — Mercado Pago webhook URL may be invalid");
  }
  return `https://${domain}/webhook/mercadopago`;
}

// ─── PIX ─────────────────────────────────────────────────────────────────────
export interface PixResult {
  paymentId:    string;
  qrCode:       string;
  qrCodeBase64: string;
  amount:       number;
}

export async function createPixPayment(opts: {
  amount:        number;
  description:   string;
  email:         string;
  discordUserId: string;
  steamId:       string;
  vipTier:       string;
}): Promise<PixResult | null> {
  const token = getToken();
  if (!token) return null;

  logger.info({ amount: opts.amount, vipTier: opts.vipTier, email: opts.email }, "Creating MP PIX payment");

  const body = {
    transaction_amount: opts.amount,
    description:        opts.description,
    payment_method_id:  "pix",
    payer: {
      email:          opts.email,
      first_name:     "Comprador",
      last_name:      "GuerraFria",
      identification: { type: "CPF", number: "19119119100" },
    },
    metadata: {
      discord_user_id: opts.discordUserId,
      steam_id:        opts.steamId,
      vip_tier:        opts.vipTier,
    },
    notification_url: getWebhookUrl(),
  };

  try {
    const res     = await fetch(`${MP_BASE}/v1/payments`, {
      method: "POST",
      headers: {
        Authorization:       `Bearer ${token}`,
        "Content-Type":      "application/json",
        "X-Idempotency-Key": `pix-${opts.discordUserId}-${opts.vipTier}-${Date.now()}`,
      },
      body: JSON.stringify(body),
    });
    const rawText = await res.text();
    if (!res.ok) {
      logger.error({ status: res.status, body: rawText }, "MP PIX payment error");
      return null;
    }
    const data = JSON.parse(rawText) as {
      id: number;
      status: string;
      point_of_interaction: { transaction_data: { qr_code: string; qr_code_base64: string } };
    };
    logger.info({ paymentId: data.id, status: data.status }, "MP PIX payment created");
    return {
      paymentId:    String(data.id),
      qrCode:       data.point_of_interaction.transaction_data.qr_code,
      qrCodeBase64: data.point_of_interaction.transaction_data.qr_code_base64,
      amount:       opts.amount,
    };
  } catch (err) {
    logger.error({ err }, "MP PIX payment exception");
    return null;
  }
}

// ─── Card (preference) ────────────────────────────────────────────────────────
export interface CardResult {
  preferenceId:     string;
  checkoutUrl:      string;
  externalReference: string;
}

export async function createCardPreference(opts: {
  amount:        number;
  title:         string;
  discordUserId: string;
  steamId:       string;
  vipTier:       string;
}): Promise<CardResult | null> {
  const token = getToken();
  if (!token) return null;

  const externalReference = `${opts.discordUserId}-${opts.vipTier}-${Date.now()}`;

  logger.info({ amount: opts.amount, vipTier: opts.vipTier, externalReference }, "Creating MP card preference");

  const body = {
    items: [{ title: opts.title, quantity: 1, unit_price: opts.amount, currency_id: "BRL" }],
    metadata: {
      discord_user_id: opts.discordUserId,
      steam_id:        opts.steamId,
      vip_tier:        opts.vipTier,
    },
    notification_url:   getWebhookUrl(),
    external_reference: externalReference,
  };

  try {
    const res     = await fetch(`${MP_BASE}/checkout/preferences`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const rawText = await res.text();
    if (!res.ok) {
      logger.error({ status: res.status, body: rawText }, "MP preference error");
      return null;
    }
    const data = JSON.parse(rawText) as { id: string; init_point: string };
    logger.info({ preferenceId: data.id, checkoutUrl: data.init_point }, "MP card preference created");
    return { preferenceId: data.id, checkoutUrl: data.init_point, externalReference };
  } catch (err) {
    logger.error({ err }, "MP preference exception");
    return null;
  }
}

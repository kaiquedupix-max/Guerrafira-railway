/** Mercado Pago API helpers — PIX and card checkout. Produção apenas. */

import { logger } from "../lib/logger.js";

const MP_BASE = "https://api.mercadopago.com";
const PIX_EXPIRATION_MINUTES = 30;

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
  paymentId:     string;
  qrCode:        string;
  qrCodeBase64:  string;
  amount:        number;
  expiresAt:     string;
}

export interface PixFailure {
  error: string;
  providerStatus?: number;
}

function readableMpError(rawText: string): string {
  try {
    const data = JSON.parse(rawText) as { message?: string; error?: string; cause?: Array<{ description?: string; code?: string }> };
    const detail = data.cause?.find(item => item.description)?.description || data.message || data.error;
    if (detail) return String(detail).replace(/[\r\n\t]/g, " ").slice(0, 220);
  } catch {}
  return "O Mercado Pago recusou a criação do pagamento.";
}

export async function createPixPayment(opts: {
  amount:        number;
  description:   string;
  email:         string;
  discordUserId: string;
  steamId:       string;
  vipTier:       string;
}): Promise<PixResult | PixFailure> {
  const token = getToken();
  if (!token) return { error: "Configuração do Mercado Pago indisponível." };

  logger.info({ amount: opts.amount, vipTier: opts.vipTier, email: opts.email }, "Creating MP PIX payment");

  // O QR Code deve vencer exatamente 30 minutos após a criação.
  // Enviamos o vencimento explicitamente para não depender do padrão do Mercado Pago.
  const requestedExpiration = new Date(Date.now() + PIX_EXPIRATION_MINUTES * 60_000).toISOString();

  const body = {
    transaction_amount: opts.amount,
    description:        opts.description,
    payment_method_id:  "pix",
    date_of_expiration: requestedExpiration,
    payer: {
      email:          opts.email,
      first_name:     "Comprador",
      last_name:      "GuerraFria",
    },
    metadata: {
      discord_user_id: opts.discordUserId,
      steam_id:        opts.steamId,
      vip_tier:        opts.vipTier,
    },
    notification_url: getWebhookUrl(),
  };

  try {
    const idempotencyKey = `pix-${opts.discordUserId}-${opts.vipTier}-${Date.now()}`;
    let res: Response | null = null;
    let rawText = "";
    for (let attempt = 1; attempt <= 2; attempt++) {
      res = await fetch(`${MP_BASE}/v1/payments`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "X-Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify(body),
      });
      rawText = await res.text();
      if (res.ok || (res.status !== 429 && res.status < 500)) break;
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 900));
    }
    if (!res) return { error: "O Mercado Pago não respondeu." };
    if (!res.ok) {
      const providerError = readableMpError(rawText);
      logger.error({ status: res.status, providerError, body: rawText.slice(0, 1000) }, "MP PIX payment error");
      return { error: providerError, providerStatus: res.status };
    }
    const data = JSON.parse(rawText) as {
      id: number;
      status: string;
      date_of_expiration?: string;
      point_of_interaction: { transaction_data: { qr_code: string; qr_code_base64: string } };
    };

    const transactionData = data.point_of_interaction?.transaction_data;
    if (!data.id || !transactionData?.qr_code) {
      logger.error({ paymentId: data.id, status: data.status }, "MP PIX response missing QR code");
      return { error: "O Mercado Pago criou o pedido, mas não retornou o código Pix." };
    }

    const expiresAt = data.date_of_expiration ?? requestedExpiration;
    logger.info(
      { paymentId: data.id, status: data.status, expiresAt, expirationMinutes: PIX_EXPIRATION_MINUTES },
      "MP PIX payment created with explicit expiration",
    );

    return {
      paymentId:    String(data.id),
      qrCode:       transactionData.qr_code,
      qrCodeBase64: transactionData.qr_code_base64 ?? "",
      amount:       opts.amount,
      expiresAt,
    };
  } catch (err) {
    logger.error({ err }, "MP PIX payment exception");
    return { error: "Falha de comunicação com o Mercado Pago. Tente novamente." };
  }
}

// ─── Card (preference) ────────────────────────────────────────────────────────
export interface CardResult {
  preferenceId:      string;
  checkoutUrl:       string;
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
    const res = await fetch(`${MP_BASE}/checkout/preferences`, {
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

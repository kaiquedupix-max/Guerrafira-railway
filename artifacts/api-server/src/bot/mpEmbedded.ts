import { logger } from "../lib/logger.js";
export function mpPublishableKey(): string {
  return (process.env.MP_PUBLIC_KEY || process.env.MERCADO_PAGO_PUBLIC_KEY || "").trim();
}
export function isEmbeddedMpConfigured(): boolean { return Boolean(mpPublishableKey() && process.env.MP_ACCESS_TOKEN?.trim()); }
export type CardData = { token: string; payment_method_id: string; installments: number; issuer_id?: string;
  payer?: { identification?: { type: string; number: string } } };
export function parseCardData(data: unknown): CardData | null {
  if (!data || typeof data !== "object") return null;
  const value = data as CardData;
  if (typeof value.token !== "string" || !/^[A-Za-z0-9_-]{8,200}$/.test(value.token) ||
    typeof value.payment_method_id !== "string" || !/^[a-z0-9_]{1,32}$/i.test(value.payment_method_id) ||
    !Number.isInteger(value.installments) || value.installments < 1 || value.installments > 12) return null;
  const identification = value.payer?.identification;
  if (identification && (!/^(CPF|CNPJ)$/.test(identification.type) || !/^\d{11,14}$/.test(identification.number))) return null;
  if (value.issuer_id && !/^\d{1,20}$/.test(String(value.issuer_id))) return null;
  return { token:value.token, payment_method_id:value.payment_method_id, installments:value.installments,
    issuer_id:value.issuer_id, payer:identification ? { identification } : undefined };
}
export async function createEmbeddedMpPayment(opts: { id: number; key: string; amount: number; email: string; tier: string;
  discord: string; steam: string; description: string; card: CardData }): Promise<Record<string, unknown> | null> {
  const appUrl = (process.env.APP_URL || "https://www.guerrafriarust.com.br").trim().replace(/\/$/, "");
  const response = await fetch("https://api.mercadopago.com/v1/payments", {
    method:"POST", headers:{ Authorization:`Bearer ${process.env.MP_ACCESS_TOKEN}`, "Content-Type":"application/json",
      "X-Idempotency-Key":`site-card-${opts.key}` },
    body:JSON.stringify({ transaction_amount:opts.amount, description:opts.description, token:opts.card.token,
      payment_method_id:opts.card.payment_method_id, installments:opts.card.installments, issuer_id:opts.card.issuer_id,
      payer:{email:opts.email, identification:opts.card.payer?.identification},
      external_reference:`site-card-${opts.key}`, notification_url:process.env.MP_WEBHOOK_URL?.trim() || `${appUrl}/webhook/mercadopago`,
      three_d_secure_mode:"optional",
      metadata:{payment_row_id:String(opts.id),discord_user_id:opts.discord,steam_id:opts.steam,vip_tier:opts.tier} }),
  });
  if (!response.ok) {
    // Provider payloads may contain cardholder data. Never log the payload/token.
    logger.warn({status:response.status,paymentRowId:opts.id},"Embedded Mercado Pago payment could not be confirmed");
    return null;
  }
  const payment = await response.json() as Record<string, unknown>;
  return payment.id ? payment : null;
}

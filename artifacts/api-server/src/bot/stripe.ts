import { createHmac, timingSafeEqual } from "node:crypto";
import { logger } from "../lib/logger.js";

const STRIPE_BASE = "https://api.stripe.com/v1";

export type StripeCheckoutSession = {
  id: string;
  object?: string;
  status?: string | null;
  payment_status?: string | null;
  payment_intent?: string | { id?: string } | null;
  client_reference_id?: string | null;
  amount_total?: number | null;
  currency?: string | null;
  url?: string | null;
  metadata?: Record<string, string> | null;
};

function secretKey(): string | null {
  const value = process.env.STRIPE_SECRET_KEY?.trim();
  if (!value) logger.warn("STRIPE_SECRET_KEY not set — Stripe card checkout disabled");
  return value || null;
}

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY?.trim());
}

function publicBaseUrl(): string {
  const explicit = process.env.APP_URL?.trim().replace(/\/$/, "");
  if (explicit) return explicit;
  const rawDomain = process.env.RAILWAY_PUBLIC_DOMAIN ?? process.env.APP_DOMAIN ?? "www.guerrafriarust.com.br";
  const domain = rawDomain.trim().replace(/^https?:\/\//i, "").replace(/\/$/, "");
  return `https://${domain}`;
}

async function stripeRequest(path: string, init?: RequestInit): Promise<Response | null> {
  const key = secretKey();
  if (!key) return null;
  return fetch(`${STRIPE_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${key}`,
      ...(init?.headers ?? {}),
    },
  });
}

function readableStripeError(rawText: string): string {
  try {
    const parsed = JSON.parse(rawText) as { error?: { message?: string } };
    const message = parsed.error?.message?.trim();
    if (message) return message.replace(/[\r\n\t]/g, " ").slice(0, 220);
  } catch {}
  return "A Stripe não conseguiu criar o checkout agora.";
}

export async function createStripeCheckout(opts: {
  paymentRowId: number;
  amount: number;
  title: string;
  email: string;
  discordUserId: string;
  steamId: string;
  vipTier: string;
}): Promise<{ sessionId: string; checkoutUrl: string } | { error: string }> {
  if (!isStripeConfigured()) return { error: "Pagamento por Stripe ainda não está configurado." };

  const baseUrl = publicBaseUrl();
  const body = new URLSearchParams();
  body.set("mode", "payment");
  body.set("success_url", `${baseUrl}/api/store/stripe/success?session_id={CHECKOUT_SESSION_ID}`);
  body.set("cancel_url", `${baseUrl}/loja?stripe=cancelled`);
  body.set("client_reference_id", String(opts.paymentRowId));
  body.set("customer_email", opts.email);
  body.set("locale", "pt-BR");
  body.set("payment_method_types[0]", "card");
  body.set("line_items[0][price_data][currency]", "brl");
  body.set("line_items[0][price_data][unit_amount]", String(Math.round(opts.amount * 100)));
  body.set("line_items[0][price_data][product_data][name]", opts.title);
  body.set("line_items[0][quantity]", "1");
  body.set("metadata[payment_row_id]", String(opts.paymentRowId));
  body.set("metadata[discord_user_id]", opts.discordUserId);
  body.set("metadata[steam_id]", opts.steamId);
  body.set("metadata[vip_tier]", opts.vipTier);
  body.set("payment_intent_data[metadata][payment_row_id]", String(opts.paymentRowId));
  body.set("payment_intent_data[metadata][discord_user_id]", opts.discordUserId);
  body.set("payment_intent_data[metadata][steam_id]", opts.steamId);
  body.set("payment_intent_data[metadata][vip_tier]", opts.vipTier);

  try {
    const response = await stripeRequest("/checkout/sessions", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Idempotency-Key": `guerra-fria-vip-${opts.paymentRowId}`,
      },
      body: body.toString(),
    });
    if (!response) return { error: "Pagamento por Stripe ainda não está configurado." };
    const rawText = await response.text();
    if (!response.ok) {
      const providerError = readableStripeError(rawText);
      logger.error({ status: response.status, providerError }, "Stripe checkout creation failed");
      return { error: providerError };
    }
    const session = JSON.parse(rawText) as StripeCheckoutSession;
    if (!session.id || !session.url) {
      logger.error({ session }, "Stripe checkout response missing id or url");
      return { error: "A Stripe criou a sessão sem uma URL válida de checkout." };
    }
    logger.info({ sessionId: session.id, paymentRowId: opts.paymentRowId, vipTier: opts.vipTier }, "Stripe checkout created");
    return { sessionId: session.id, checkoutUrl: session.url };
  } catch (err) {
    logger.error({ err, paymentRowId: opts.paymentRowId }, "Stripe checkout exception");
    return { error: "Falha de comunicação com a Stripe. Tente novamente." };
  }
}

export async function retrieveStripeCheckout(sessionId: string): Promise<StripeCheckoutSession | null> {
  if (!/^cs_(?:test_|live_)?[A-Za-z0-9_]+$/.test(sessionId)) return null;
  try {
    const response = await stripeRequest(`/checkout/sessions/${encodeURIComponent(sessionId)}`, { method: "GET" });
    if (!response) return null;
    const rawText = await response.text();
    if (!response.ok) {
      logger.error({ status: response.status, sessionId, body: rawText.slice(0, 500) }, "Stripe checkout lookup failed");
      return null;
    }
    return JSON.parse(rawText) as StripeCheckoutSession;
  } catch (err) {
    logger.error({ err, sessionId }, "Stripe checkout lookup exception");
    return null;
  }
}

export function verifyStripeWebhookSignature(rawBody: string, signatureHeader: string | undefined): boolean {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret || !signatureHeader) return false;
  const parts = signatureHeader.split(",").map(part => part.trim());
  const timestampPart = parts.find(part => part.startsWith("t="));
  const signatures = parts.filter(part => part.startsWith("v1=")).map(part => part.slice(3));
  const timestamp = timestampPart ? Number(timestampPart.slice(2)) : NaN;
  if (!Number.isFinite(timestamp) || signatures.length === 0) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - timestamp) > 300) return false;

  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  return signatures.some(signature => {
    try {
      const candidate = Buffer.from(signature, "hex");
      return candidate.length === expectedBuffer.length && timingSafeEqual(candidate, expectedBuffer);
    } catch {
      return false;
    }
  });
}

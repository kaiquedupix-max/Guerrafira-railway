import { Router, type Request, type Response } from "express";
import { db, paymentsTable } from "@workspace/db";
import { getCommunitySession } from "../admin/communitySession.js";
import { createCardPreference, createPixPayment } from "../bot/mp.js";
import { VIP_TIERS, type VipTier } from "../bot/vip.js";
import { logger } from "../lib/logger.js";

const router = Router();

function parseTier(value: unknown): VipTier | null {
  return value === "bronze" || value === "prata" || value === "ouro" ? value : null;
}

function validate(req: Request, res: Response): { tier: VipTier; steamId: string; email: string; discordUserId: string } | null {
  const session = getCommunitySession(req);
  if (!session) {
    res.status(401).json({ error: "Sua sessão expirou. Entre novamente com o Discord." });
    return null;
  }

  const tier = parseTier(req.body?.tier);
  const steamId = String(req.body?.steamId ?? "").trim();
  const email = String(req.body?.email ?? "").trim();

  if (!tier) {
    res.status(400).json({ error: "Plano VIP inválido." });
    return null;
  }
  if (!/^7656119\d{10}$/.test(steamId)) {
    res.status(400).json({ error: "SteamID64 inválido." });
    return null;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    res.status(400).json({ error: "E-mail inválido." });
    return null;
  }

  return { tier, steamId, email, discordUserId: session.userId };
}

router.post("/pix", async (req, res) => {
  const input = validate(req, res);
  if (!input) return;
  const vip = VIP_TIERS[input.tier];

  try {
    const payment = await createPixPayment({
      amount: vip.price,
      description: `${vip.name} Guerra Fria - 30 dias`,
      email: input.email,
      discordUserId: input.discordUserId,
      steamId: input.steamId,
      vipTier: input.tier,
    });

    if ("error" in payment) {
      return res.status(502).json({ error: payment.error });
    }

    await db.insert(paymentsTable).values({
      mpPaymentId: payment.paymentId,
      discordUserId: input.discordUserId,
      steamId: input.steamId,
      email: input.email,
      vipTier: input.tier,
      amount: vip.price.toFixed(2),
      method: "pix",
      status: "pending",
    });

    return res.json({
      paymentId: payment.paymentId,
      qrCode: payment.qrCode,
      qrCodeBase64: payment.qrCodeBase64,
      expiresAt: payment.expiresAt,
    });
  } catch (err) {
    logger.error({ err, tier: input.tier, discordUserId: input.discordUserId }, "Web store PIX error");
    return res.status(500).json({ error: "Não foi possível gerar o PIX agora. Tente novamente." });
  }
});

router.post("/card", async (req, res) => {
  const input = validate(req, res);
  if (!input) return;
  const vip = VIP_TIERS[input.tier];

  try {
    const preference = await createCardPreference({
      amount: vip.price,
      title: `${vip.name} Guerra Fria - 30 dias`,
      discordUserId: input.discordUserId,
      steamId: input.steamId,
      vipTier: input.tier,
    });

    if (!preference) {
      return res.status(502).json({ error: "O Mercado Pago não conseguiu criar o checkout do cartão." });
    }

    await db.insert(paymentsTable).values({
      mpPreferenceId: preference.preferenceId,
      mpExternalReference: preference.externalReference,
      discordUserId: input.discordUserId,
      steamId: input.steamId,
      email: input.email,
      vipTier: input.tier,
      amount: vip.price.toFixed(2),
      method: "credit_card",
      status: "pending",
    });

    return res.json({ checkoutUrl: preference.checkoutUrl, preferenceId: preference.preferenceId });
  } catch (err) {
    logger.error({ err, tier: input.tier, discordUserId: input.discordUserId }, "Web store card error");
    return res.status(500).json({ error: "Não foi possível abrir o checkout do cartão agora. Tente novamente." });
  }
});

export default router;

import { Router, type Request, type Response } from "express";
import { db, paymentsTable } from "@workspace/db";
import { getCommunitySession } from "../admin/communitySession.js";
import { createCardPreference, createPixPayment } from "../bot/mp.js";
import { getLinkedSteamV2, saveLinkedSteamV2, STEAM_LOCKED_NOTICE } from "../bot/utils/linkedSteamV2.js";
import { VIP_TIERS, type VipTier } from "../bot/vip.js";
import { logger } from "../lib/logger.js";

const router = Router();
const BASE_URL = "https://www.guerrafriarust.com.br";
const STEAM_OPENID = "https://steamcommunity.com/openid/login";

function parseTier(value: unknown): VipTier | null { return value === "bronze" || value === "prata" || value === "ouro" ? value : null; }

async function validate(req: Request, res: Response): Promise<{ tier: VipTier; steamId: string; email: string; discordUserId: string } | null> {
  const session = getCommunitySession(req);
  if (!session) { res.status(401).json({ error: "Sua sessão expirou. Entre novamente com o Discord." }); return null; }
  const tier = parseTier(req.body?.tier);
  const email = String(req.body?.email ?? "").trim();
  if (!tier) { res.status(400).json({ error: "Plano VIP inválido." }); return null; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { res.status(400).json({ error: "E-mail inválido." }); return null; }
  const linked = await getLinkedSteamV2(session.userId);
  if (!linked?.steamId) { res.status(409).json({ error: "Conecte sua Steam pelo login oficial antes de finalizar a compra." }); return null; }
  return { tier, steamId: linked.steamId, email, discordUserId: session.userId };
}

router.get("/steam/login", (req, res) => {
  const session = getCommunitySession(req);
  if (!session) return void res.redirect("/api/admin/auth/login?target=store");
  const returnTo = `${BASE_URL}/api/store/steam/callback`;
  const q = new URLSearchParams({
    "openid.ns":"http://specs.openid.net/auth/2.0",
    "openid.mode":"checkid_setup",
    "openid.return_to":returnTo,
    "openid.realm":BASE_URL,
    "openid.identity":"http://specs.openid.net/auth/2.0/identifier_select",
    "openid.claimed_id":"http://specs.openid.net/auth/2.0/identifier_select",
  });
  return void res.redirect(`${STEAM_OPENID}?${q.toString()}`);
});

router.get("/steam/callback", async(req,res)=>{
  const session=getCommunitySession(req);
  if(!session)return void res.redirect("/api/admin/auth/login?target=store");
  try{
    const params=new URLSearchParams();
    for(const [key,value] of Object.entries(req.query))if(key.startsWith("openid.")&&typeof value==="string")params.set(key,value);
    params.set("openid.mode","check_authentication");
    const verify=await fetch(STEAM_OPENID,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:params});
    const text=await verify.text();
    if(!verify.ok||!/is_valid\s*:\s*true/i.test(text))throw new Error("Steam não confirmou a autenticação.");
    const claimed=typeof req.query["openid.claimed_id"]==="string"?String(req.query["openid.claimed_id"]):"";
    const match=claimed.match(/^https?:\/\/steamcommunity\.com\/openid\/id\/(7656119\d{10})\/?$/i);
    if(!match)throw new Error("SteamID inválido retornado pela Steam.");
    const saved=await saveLinkedSteamV2(session.userId,match[1]);
    if(!saved.ok){
      const message=saved.reason==="discord-linked"?STEAM_LOCKED_NOTICE:"Esta Steam já está vinculada a outra conta do Discord.";
      return void res.status(409).type("html").send(`<meta name="viewport" content="width=device-width"><body style="background:#08070a;color:white;font-family:system-ui;padding:30px"><h1>Não foi possível vincular</h1><p>${message}</p><a style="color:#66c0f4" href="/loja">Voltar à loja</a></body>`);
    }
    return void res.redirect("/loja?steam=ok");
  }catch(error){logger.error({error,discordUserId:session.userId},"store steam callback failed");return void res.status(401).type("html").send(`<meta name="viewport" content="width=device-width"><body style="background:#08070a;color:white;font-family:system-ui;padding:30px"><h1>Falha ao confirmar Steam</h1><p>Tente novamente pelo botão Entrar com Steam.</p><a style="color:#66c0f4" href="/loja">Voltar à loja</a></body>`)}
});

router.get("/me", async (req, res) => {
  const session = getCommunitySession(req);
  if (!session) return res.status(401).json({ error: "Sua sessão expirou. Entre novamente com o Discord." });
  const linked = await getLinkedSteamV2(session.userId);
  return res.json({ discordUserId: session.userId, username: session.username, steamId: linked?.steamId ?? null });
});

router.post("/pix", async (req, res) => {
  const input = await validate(req, res); if (!input) return;
  const vip = VIP_TIERS[input.tier];
  try {
    const payment = await createPixPayment({ amount: vip.price, description: `${vip.name} Guerra Fria - 30 dias`, email: input.email, discordUserId: input.discordUserId, steamId: input.steamId, vipTier: input.tier });
    if ("error" in payment) return res.status(502).json({ error: payment.error });
    await db.insert(paymentsTable).values({ mpPaymentId: payment.paymentId, discordUserId: input.discordUserId, steamId: input.steamId, email: input.email, vipTier: input.tier, amount: vip.price.toFixed(2), method: "pix", status: "pending" });
    return res.json({ paymentId: payment.paymentId, qrCode: payment.qrCode, qrCodeBase64: payment.qrCodeBase64, expiresAt: payment.expiresAt, steamId: input.steamId });
  } catch (err) { logger.error({ err, tier: input.tier, discordUserId: input.discordUserId }, "Web store PIX error"); return res.status(500).json({ error: "Não foi possível gerar o PIX agora. Tente novamente." }); }
});

router.post("/card", async (req, res) => {
  const input = await validate(req, res); if (!input) return;
  const vip = VIP_TIERS[input.tier];
  try {
    const preference = await createCardPreference({ amount: vip.price, title: `${vip.name} Guerra Fria - 30 dias`, discordUserId: input.discordUserId, steamId: input.steamId, vipTier: input.tier });
    if (!preference) return res.status(502).json({ error: "O Mercado Pago não conseguiu criar o checkout do cartão." });
    await db.insert(paymentsTable).values({ mpPreferenceId: preference.preferenceId, mpExternalReference: preference.externalReference, discordUserId: input.discordUserId, steamId: input.steamId, email: input.email, vipTier: input.tier, amount: vip.price.toFixed(2), method: "credit_card", status: "pending" });
    return res.json({ checkoutUrl: preference.checkoutUrl, preferenceId: preference.preferenceId, steamId: input.steamId });
  } catch (err) { logger.error({ err, tier: input.tier, discordUserId: input.discordUserId }, "Web store card error"); return res.status(500).json({ error: "Não foi possível abrir o checkout do cartão agora. Tente novamente." }); }
});

export default router;

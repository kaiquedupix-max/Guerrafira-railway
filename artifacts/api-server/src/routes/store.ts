import { Router, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { db, paymentsTable } from "@workspace/db";
import { getCommunitySession } from "../admin/communitySession.js";
import { createCardPreference, createPixPayment } from "../bot/mp.js";
import { createStripeCheckout, isStripeConfigured, retrieveStripeCheckout } from "../bot/stripe.js";
import { getLinkedSteamV2, saveLinkedSteamV2, STEAM_LOCKED_NOTICE } from "../bot/utils/linkedSteamV2.js";
import { VIP_PRODUCTS, isVipProduct, type VipProduct } from "../bot/vipProducts.js";
import { GUERRA_FRIA_SERVERS, parseServerId, type GuerraFriaServerId } from "../core/servers.js";
import { logger } from "../lib/logger.js";
import { processStripeCheckoutSession } from "./stripePayment.js";
import { duoSecret } from "./duoPolicy.js";
import { ensureDuoSchema, listDuoPurchases } from "./duoService.js";
import duoRouter from "./duoRoutes.js";
import { officialSteam, recordOfficialSteam, steamState, readSteamState } from "./storeSteamAuth.js";

const router = Router();
router.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
router.use("/duo", duoRouter);
const BASE_URL = "https://www.guerrafriarust.com.br";
const STEAM_OPENID = "https://steamcommunity.com/openid/login";

function parseTier(value: unknown): VipProduct | null { return isVipProduct(value) ? value : null; }

async function validate(req: Request, res: Response): Promise<{ tier: VipProduct; serverId: GuerraFriaServerId; steamId: string; email: string; discordUserId: string } | null> {
  const session = getCommunitySession(req);
  if (!session) { res.status(401).json({ error: "Sua sessão expirou. Entre novamente com o Discord." }); return null; }
  const tier = parseTier(req.body?.tier);
  const serverId = parseServerId(req.body?.serverId ?? "solo-duo");
  const email = String(req.body?.email ?? "").trim();
  if (!tier) { res.status(400).json({ error: "Plano VIP inválido." }); return null; }
  if (!serverId) { res.status(400).json({ error: "Servidor inválido." }); return null; }
  const server = GUERRA_FRIA_SERVERS[serverId];
  if (!server.enabled || server.comingSoon) { res.status(409).json({ error: `${server.name} ainda está em preparação. As compras serão liberadas em breve.` }); return null; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { res.status(400).json({ error: "E-mail inválido." }); return null; }
  const linked = await getLinkedSteamV2(session.userId);
  if (!linked?.steamId) { res.status(409).json({ error: "Conecte sua Steam pelo login oficial antes de finalizar a compra." }); return null; }
  if (tier === "duo") {
    if (!(await officialSteam(session.userId, linked.steamId))) { res.status(409).json({ error: "Entre com Steam pelo botão oficial para comprar o Super Combo Duo." }); return null; }
    duoSecret();
    await ensureDuoSchema();
  }
  return { tier, serverId, steamId: linked.steamId, email, discordUserId: session.userId };
}

router.get("/servers", (_req, res) => {
  return res.json(Object.values(GUERRA_FRIA_SERVERS).map(server => ({
    id: server.id,
    name: server.name,
    shortName: server.shortName,
    teamSize: server.teamSize,
    enabled: server.enabled,
    comingSoon: server.comingSoon,
  })));
});

router.get("/steam/login", (req, res) => {
  const session = getCommunitySession(req);
  if (!session) return void res.redirect("/api/admin/auth/login?target=store");
  const state = steamState(session.userId, req.query.duo === "1");
  res.cookie("gf_store_steam_state", state, { httpOnly:true, secure:true, sameSite:"lax", path:"/api/store/steam", maxAge:600_000 });
  const decoded = readSteamState(state, session.userId)!;
  const returnTo = `${BASE_URL}/api/store/steam/callback?state=${decoded.nonce}`;
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
    const state = readSteamState(String(req.cookies?.gf_store_steam_state || ""), session.userId);
    res.clearCookie("gf_store_steam_state", { path:"/api/store/steam", secure:true, sameSite:"lax" });
    if (!state || req.query.state !== state.nonce ||
      req.query["openid.return_to"] !== `${BASE_URL}/api/store/steam/callback?state=${state.nonce}` ||
      req.query["openid.op_endpoint"] !== STEAM_OPENID) throw new Error("Estado Steam inválido.");
    const signed = String(req.query["openid.signed"] || "").split(",");
    if (!["op_endpoint","claimed_id","identity","return_to","response_nonce"].every(field => signed.includes(field))) throw new Error("Resposta Steam incompleta.");
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
    await recordOfficialSteam(session.userId, match[1]);
    return void res.redirect(state.duo ? "/api/store/duo/redeem" : "/loja?steam=ok");
  }catch(error){logger.error({error,discordUserId:session.userId},"store steam callback failed");return void res.status(401).type("html").send(`<meta name="viewport" content="width=device-width"><body style="background:#08070a;color:white;font-family:system-ui;padding:30px"><h1>Falha ao confirmar Steam</h1><p>Tente novamente pelo botão Entrar com Steam.</p><a style="color:#66c0f4" href="/loja">Voltar à loja</a></body>`)}
});

router.get("/me", async (req, res) => {
  const session = getCommunitySession(req);
  if (!session) return res.status(401).json({ error: "Sua sessão expirou. Entre novamente com o Discord." });
  const linked = await getLinkedSteamV2(session.userId);
  return res.json({ discordUserId: session.userId, username: session.username, steamId: linked?.steamId ?? null,
    steamVerified: linked?.steamId ? await officialSteam(session.userId, linked.steamId) : false, stripeEnabled: isStripeConfigured() });
});

router.get("/duo-purchases", async (req, res) => {
  const session = getCommunitySession(req);
  if (!session) return res.status(401).json({ error: "Entre com Discord." });
  return res.json(await listDuoPurchases(session.userId));
});

router.post("/pix", async (req, res) => {
  const input = await validate(req, res); if (!input) return;
  const vip = VIP_PRODUCTS[input.tier];
  const server = GUERRA_FRIA_SERVERS[input.serverId];
  try {
    const payment = await createPixPayment({ amount: vip.price, description: `${vip.name} Guerra Fria ${server.shortName} - 30 dias`, email: input.email, discordUserId: input.discordUserId, steamId: input.steamId, vipTier: input.tier });
    if ("error" in payment) return res.status(502).json({ error: payment.error });
    await db.insert(paymentsTable).values({ mpPaymentId: payment.paymentId, discordUserId: input.discordUserId, steamId: input.steamId, email: input.email, vipTier: input.tier, amount: vip.price.toFixed(2), method: "pix", status: "pending" });
    return res.json({ paymentId: payment.paymentId, qrCode: payment.qrCode, qrCodeBase64: payment.qrCodeBase64, expiresAt: payment.expiresAt, steamId: input.steamId, serverId: input.serverId });
  } catch (err) { logger.error({ err, tier: input.tier, serverId: input.serverId, discordUserId: input.discordUserId }, "Web store PIX error"); return res.status(500).json({ error: "Não foi possível gerar o PIX agora. Tente novamente." }); }
});

router.post("/card", async (req, res) => {
  const input = await validate(req, res); if (!input) return;
  const vip = VIP_PRODUCTS[input.tier];
  const server = GUERRA_FRIA_SERVERS[input.serverId];
  try {
    const preference = await createCardPreference({ amount: vip.price, title: `${vip.name} Guerra Fria ${server.shortName} - 30 dias`, discordUserId: input.discordUserId, steamId: input.steamId, vipTier: input.tier });
    if (!preference) return res.status(502).json({ error: "O Mercado Pago não conseguiu criar o checkout do cartão. Você pode tentar a opção Cartão • Stripe." });
    await db.insert(paymentsTable).values({ mpPreferenceId: preference.preferenceId, mpExternalReference: preference.externalReference, discordUserId: input.discordUserId, steamId: input.steamId, email: input.email, vipTier: input.tier, amount: vip.price.toFixed(2), method: "credit_card", status: "pending" });
    return res.json({ checkoutUrl: preference.checkoutUrl, preferenceId: preference.preferenceId, steamId: input.steamId, serverId: input.serverId });
  } catch (err) { logger.error({ err, tier: input.tier, serverId: input.serverId, discordUserId: input.discordUserId }, "Web store card error"); return res.status(500).json({ error: "Não foi possível abrir o cartão no Mercado Pago. Tente pagar com Cartão • Stripe." }); }
});

router.post("/stripe/card", async (req, res) => {
  const input = await validate(req, res); if (!input) return;
  if (!isStripeConfigured()) return res.status(503).json({ error: "Pagamento por Stripe ainda não está configurado." });
  const vip = VIP_PRODUCTS[input.tier];
  const server = GUERRA_FRIA_SERVERS[input.serverId];
  try {
    const [row] = await db.insert(paymentsTable).values({
      discordUserId: input.discordUserId,
      steamId: input.steamId,
      email: input.email,
      vipTier: input.tier,
      amount: vip.price.toFixed(2),
      method: "stripe_card",
      status: "pending",
    }).returning({ id: paymentsTable.id });
    if (!row) return res.status(500).json({ error: "Não foi possível registrar a compra Stripe." });

    const checkout = await createStripeCheckout({
      paymentRowId: row.id,
      amount: vip.price,
      title: `${vip.name} Guerra Fria ${server.shortName} - 30 dias`,
      email: input.email,
      discordUserId: input.discordUserId,
      steamId: input.steamId,
      vipTier: input.tier,
    });
    if ("error" in checkout) {
      await db.update(paymentsTable).set({ status: "failed", updatedAt: new Date() }).where(eq(paymentsTable.id, row.id));
      return res.status(502).json({ error: checkout.error });
    }

    await db.update(paymentsTable).set({ stripeSessionId: checkout.sessionId, updatedAt: new Date() })
      .where(eq(paymentsTable.id, row.id));
    return res.json({ checkoutUrl: checkout.checkoutUrl, sessionId: checkout.sessionId, steamId: input.steamId, serverId: input.serverId });
  } catch (err) {
    logger.error({ err, tier: input.tier, serverId: input.serverId, discordUserId: input.discordUserId }, "Web store Stripe card error");
    return res.status(500).json({ error: "Não foi possível abrir o checkout da Stripe agora. Tente novamente." });
  }
});

router.get("/stripe/success", async (req, res) => {
  const sessionId = typeof req.query.session_id === "string" ? req.query.session_id : "";
  if (!sessionId) return void res.redirect("/loja?stripe=error");
  try {
    const checkout = await retrieveStripeCheckout(sessionId);
    if (!checkout) return void res.redirect("/loja?stripe=error");
    const processed = await processStripeCheckoutSession(checkout);
    if (processed && checkout.payment_status === "paid") return void res.redirect("/loja?stripe=success");
    return void res.redirect("/loja?stripe=pending");
  } catch (err) {
    logger.error({ err, sessionId }, "Stripe checkout success reconciliation failed");
    return void res.redirect("/loja?stripe=error");
  }
});

export default router;

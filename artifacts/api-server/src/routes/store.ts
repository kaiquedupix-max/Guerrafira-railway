import { Router, type Request, type Response } from "express";
import { and, eq } from "drizzle-orm";
import { db, paymentsTable } from "@workspace/db";
import { getCommunitySession } from "../admin/communitySession.js";
import { createPixPayment } from "../bot/mp.js";
import { createStripeCheckout, isStripeConfigured, retrieveStripeCheckout } from "../bot/stripe.js";
import { receiptState } from "./storeReceipts.js";
import { getLinkedSteamV2, saveLinkedSteamV2, STEAM_LOCKED_NOTICE } from "../bot/utils/linkedSteamV2.js";
import { VIP_PRODUCTS, isVipProduct, type VipProduct } from "../bot/vipProducts.js";
import { GUERRA_FRIA_SERVERS, parseServerId, type GuerraFriaServerId } from "../core/servers.js";
import { logger } from "../lib/logger.js";
import { processStripeCheckoutSession } from "./stripePayment.js";
import { duoSecret } from "./duoPolicy.js";
import { ensureDuoSchema, listDuoPurchases } from "./duoService.js";
import duoRouter from "./duoRoutes.js";
import { officialSteam, recordOfficialSteam, steamState, readSteamState } from "./storeSteamAuth.js";

import { isEmbeddedMpConfigured, mpPublishableKey, parseCardData, createEmbeddedMpPayment } from "../bot/mpEmbedded.js";
import { cardAttempt, isAttemptId } from "./storeCardAttempts.js";
import { fetchMpPayment, processMpPayment } from "./paymentReconciler.js";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const router = Router();
for (const [slug, filename] of [["duo", "vip-super-combo-duo.png"], ["duo-banner", "vip-super-combo-duo-banner.png"], ["store-banner", "vip-store-banner.png"]] as const) router.get(`/art/${slug}`, (_req,res) => {
  res.setHeader("Cache-Control","public, max-age=86400");
  const built=fileURLToPath(new URL(`./assets/${filename}`,import.meta.url));
  const local=resolve(process.cwd(),"assets",filename);
  res.sendFile(existsSync(built)?built:existsSync(local)?local:resolve(process.cwd(),"artifacts/api-server/assets",filename));
});
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
  if (email.length > 128 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { res.status(400).json({ error: "E-mail inválido." }); return null; }
  const linked = await getLinkedSteamV2(session.userId);
  if (!linked?.steamId) { res.status(409).json({ error: "Conecte sua Steam pelo login oficial antes de finalizar a compra." }); return null; }
  if (!(await officialSteam(session.userId, linked.steamId))) { res.status(409).json({ error: "Entre com Steam pelo botão oficial para comprar seu VIP." }); return null; }
  if (tier === "duo") {
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
    steamVerified: linked?.steamId ? await officialSteam(session.userId, linked.steamId) : false, stripeEnabled: isStripeConfigured(), mpEnabled: isEmbeddedMpConfigured(), mpPublicKey: mpPublishableKey() });
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
    const [row] = await db.insert(paymentsTable).values({ mpPaymentId: payment.paymentId, discordUserId: input.discordUserId, steamId: input.steamId, email: input.email, vipTier: input.tier, amount: vip.price.toFixed(2), method: "pix", status: "pending" }).returning({ id: paymentsTable.id });
    return res.json({ rowId: row?.id, paymentId: payment.paymentId, qrCode: payment.qrCode, qrCodeBase64: payment.qrCodeBase64, expiresAt: payment.expiresAt, steamId: input.steamId, serverId: input.serverId });
  } catch (err) { logger.error({ err, tier: input.tier, serverId: input.serverId, discordUserId: input.discordUserId }, "Web store PIX error"); return res.status(500).json({ error: "Não foi possível gerar o PIX agora. Tente novamente." }); }
});

router.post("/card", async (req,res) => {
  const input = await validate(req,res); if(!input) return;
  if(!isEmbeddedMpConfigured()) return res.status(503).json({error:"Cartão Mercado Pago indisponível. Use PIX ou Stripe."});
  const card = parseCardData(req.body?.card);
  if(!card || !isAttemptId(req.body?.attemptId)) return res.status(400).json({error:"Dados do cartão inválidos. Preencha o formulário seguro."});
  const vip=VIP_PRODUCTS[input.tier];
  try {
    const row=await cardAttempt(req.body.attemptId,input,vip.price);
    const payment=row.mp_payment_id ? await fetchMpPayment(row.mp_payment_id) : await createEmbeddedMpPayment({
      id:row.id,key:req.body.attemptId,amount:vip.price,email:input.email,tier:input.tier,
      discord:input.discordUserId,steam:input.steamId,description:vip.name+" Guerra Fria - 30 dias",card});
    if(!payment) return res.status(502).json({error:"Não foi possível confirmar a tentativa. Tente novamente neste formulário; a mesma tentativa não gera cobrança duplicada."});
    await db.update(paymentsTable).set({mpPaymentId:String(payment.id),updatedAt:new Date()}).where(eq(paymentsTable.id,row.id));
    await processMpPayment(payment).catch(() => logger.warn({paymentRowId:row.id},"Delivery will be retried by reconciler"));
    const info=payment.three_ds_info as {external_resource_url?:string;creq?:string}|undefined;
    return res.json({rowId:row.id,paymentId:String(payment.id),status:payment.status,
      threeDSInfo:info ? {externalResourceURL:info.external_resource_url,creq:info.creq} : undefined});
  } catch { return res.status(500).json({error:"Não foi possível concluir esta tentativa. Tente novamente no mesmo formulário."}); }
});

router.get("/payments/:id", async(req,res) => {
  const session=getCommunitySession(req);
  if(!session) return res.status(401).json({error:"Entre com Discord."});
  const id=Number(req.params.id);
  if(!Number.isSafeInteger(id)||id<1) return res.status(400).json({error:"Compra inválida."});
  const [row]=await db.select().from(paymentsTable).where(and(eq(paymentsTable.id,id),eq(paymentsTable.discordUserId,session.userId))).limit(1);
  if(!row) return res.status(404).json({error:"Compra não encontrada."});
  const receipt = await receiptState(row.id);
  const duo = row.vipTier === "duo" && row.status === "approved" ? (await listDuoPurchases(session.userId)).find(p => p.id === row.id) : null;
  return res.json({id:row.id,status:row.status,delivered:Boolean(receipt?.completed_at),
    product: isVipProduct(row.vipTier) ? VIP_PRODUCTS[row.vipTier].name : "VIP", amount:row.amount,
    steamId:row.steamId, claimUrl:duo?.claimUrl ?? null, claimStatus:duo?.claimStatus, expiresAt:duo?.expiresAt,
    dmStatus:receipt?.sent_at ? "sent" : receipt?.attempts ? "retrying" : "pending"});
});

router.post("/payments/:id/confirm", async(req,res) => {
  const session=getCommunitySession(req);
  if(!session) return res.status(401).json({error:"Entre com Discord."});
  const id=Number(req.params.id);
  if(!Number.isSafeInteger(id)||id<1) return res.status(400).json({error:"Compra inválida."});
  const [row]=await db.select().from(paymentsTable).where(and(eq(paymentsTable.id,id),eq(paymentsTable.discordUserId,session.userId))).limit(1);
  if(!row) return res.status(404).json({error:"Compra não encontrada."});
  try {
    if(row.stripeSessionId){ const checkout=await retrieveStripeCheckout(row.stripeSessionId); if(checkout) await processStripeCheckoutSession(checkout); }
    return res.json({ok:true});
  } catch { return res.status(502).json({error:"A confirmação continuará automaticamente."}); }
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
      embedded: false,
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
    return res.json({ rowId: row.id, checkoutUrl: checkout.checkoutUrl, sessionId: checkout.sessionId, steamId: input.steamId, serverId: input.serverId });
  } catch (err) {
    logger.error({ err, tier: input.tier, serverId: input.serverId, discordUserId: input.discordUserId }, "Web store Stripe card error");
    return res.status(500).json({ error: "Não foi possível abrir o checkout da Stripe agora. Tente novamente." });
  }
});

router.get("/stripe/success", async (req, res) => {
  const buyer = getCommunitySession(req);
  if (!buyer) return void res.redirect("/loja");
  const sessionId = typeof req.query.session_id === "string" ? req.query.session_id : "";
  if (!sessionId) return void res.redirect("/loja?stripe=error");
  try {
    const checkout = await retrieveStripeCheckout(sessionId);
    if (!checkout) return void res.redirect("/loja?stripe=error");
    const [owned] = await db.select().from(paymentsTable).where(and(eq(paymentsTable.stripeSessionId,sessionId),eq(paymentsTable.discordUserId,buyer.userId))).limit(1);
    if (!owned) return void res.redirect("/loja?stripe=error");
    const processed = await processStripeCheckoutSession(checkout);
    return void res.redirect(`/loja?payment=${owned.id}&stripe=${processed && checkout.payment_status === "paid" ? "success" : "pending"}`);
  } catch (err) {
    logger.error({ err, sessionId }, "Stripe checkout success reconciliation failed");
    return void res.redirect("/loja?stripe=error");
  }
});

export default router;

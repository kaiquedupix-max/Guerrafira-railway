import { randomBytes } from "node:crypto";
import { Router, type Request, type Response, type IRouter } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { getCommunitySession } from "../admin/communitySession.js";
import { getLinkedSteamV2, saveLinkedSteamV2, STEAM_LOCKED_NOTICE } from "../bot/utils/linkedSteamV2.js";
import { discordClient } from "../bot/client.js";
import { grantVip } from "../bot/vip.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();
const BASE_URL = "https://www.guerrafriarust.com.br";
const MP_BASE = "https://api.mercadopago.com";
const STEAM_OPENID = "https://steamcommunity.com/openid/login";
const PRICE = 100;
const SEASON_KEY = 101;
let ensured = false;
let reconciling = false;
let reconcilerStarted = false;

type PromoOrder = {
  id: number;
  gift_token: string;
  buyer_discord_id: string;
  buyer_discord_name: string;
  buyer_steam_id: string;
  buyer_email: string;
  amount: string | number;
  status: string;
  method: string | null;
  mp_payment_id: string | null;
  mp_preference_id: string | null;
  mp_external_reference: string | null;
  buyer_fulfilled_at: Date | string | null;
  gift_redeemed_at: Date | string | null;
  gift_discord_id: string | null;
  gift_discord_name: string | null;
  gift_steam_id: string | null;
  fulfillment_error: string | null;
  created_at: Date | string;
};

type MpPayment = Record<string, unknown>;

function mpToken(): string | null {
  const value = process.env.MP_ACCESS_TOKEN?.trim();
  if (!value) logger.error("MP_ACCESS_TOKEN não configurado — Supercombo indisponível");
  return value || null;
}

function webhookUrl(): string {
  const raw = process.env.RAILWAY_PUBLIC_DOMAIN ?? process.env.APP_DOMAIN ?? "www.guerrafriarust.com.br";
  const domain = raw.trim().replace(/^https?:\/\//i, "").replace(/\/$/, "");
  return `https://${domain}/webhook/mercadopago`;
}

async function ensurePromo(): Promise<void> {
  if (ensured) return;
  await db.execute(sql`CREATE TABLE IF NOT EXISTS season_start_promo_orders(
    id BIGSERIAL PRIMARY KEY,
    gift_token TEXT NOT NULL UNIQUE,
    buyer_discord_id TEXT NOT NULL,
    buyer_discord_name TEXT NOT NULL,
    buyer_steam_id TEXT NOT NULL,
    buyer_email TEXT NOT NULL,
    amount NUMERIC(10,2) NOT NULL DEFAULT 100,
    status TEXT NOT NULL DEFAULT 'pending',
    method TEXT,
    mp_payment_id TEXT UNIQUE,
    mp_preference_id TEXT,
    mp_external_reference TEXT UNIQUE,
    buyer_fulfilled_at TIMESTAMPTZ,
    gift_redeemed_at TIMESTAMPTZ,
    gift_discord_id TEXT,
    gift_discord_name TEXT,
    gift_steam_id TEXT,
    fulfillment_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS season_start_promo_buyer_idx ON season_start_promo_orders(buyer_discord_id,created_at DESC)`);
  await db.execute(sql`CREATE TABLE IF NOT EXISTS season_official_registrations(
    season_key INTEGER NOT NULL,discord_id TEXT NOT NULL,discord_name TEXT NOT NULL,steam_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',amount NUMERIC(10,2) NOT NULL DEFAULT 20,mp_payment_id TEXT,mp_preference_id TEXT,
    full_name TEXT,contact_email TEXT,prize_pix_type TEXT,prize_pix_key TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    paid_at TIMESTAMPTZ,updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),PRIMARY KEY(season_key,discord_id))`);
  await db.execute(sql`ALTER TABLE season_official_registrations ADD COLUMN IF NOT EXISTS entry_type TEXT NOT NULL DEFAULT 'paid'`);
  await db.execute(sql`ALTER TABLE season_official_registrations ADD COLUMN IF NOT EXISTS accepted_terms_at TIMESTAMPTZ`);
  ensured = true;
}

function rows<T = PromoOrder>(result: any): T[] { return Array.isArray(result?.rows) ? result.rows as T[] : []; }
function giftUrl(token: string): string { return `${BASE_URL}/promo/resgatar?gift=${encodeURIComponent(token)}`; }
function validGift(value: unknown): string { const v = String(value ?? "").trim(); return /^[A-Za-z0-9_-]{32,96}$/.test(v) ? v : ""; }
function validEmail(value: unknown): string { const v = String(value ?? "").trim().toLowerCase(); return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) ? v.slice(0,160) : ""; }

async function latestBuyerOrder(discordId: string): Promise<PromoOrder | null> {
  await ensurePromo();
  const result: any = await db.execute(sql`SELECT * FROM season_start_promo_orders WHERE buyer_discord_id=${discordId} ORDER BY created_at DESC LIMIT 1`);
  return rows(result)[0] ?? null;
}

async function orderByGift(token: string): Promise<PromoOrder | null> {
  await ensurePromo();
  const result: any = await db.execute(sql`SELECT * FROM season_start_promo_orders WHERE gift_token=${token} LIMIT 1`);
  return rows(result)[0] ?? null;
}

async function seasonEnroll(opts: { discordId:string; discordName:string; steamId:string; email?:string|null; paymentId?:string|null; preferenceId?:string|null }): Promise<void> {
  await ensurePromo();
  await db.execute(sql`
    INSERT INTO season_official_registrations(
      season_key,discord_id,discord_name,steam_id,status,amount,mp_payment_id,mp_preference_id,
      full_name,contact_email,entry_type,accepted_terms_at,paid_at,updated_at
    ) VALUES(
      ${SEASON_KEY},${opts.discordId},${opts.discordName},${opts.steamId},'approved',0,
      ${opts.paymentId ?? null},${opts.preferenceId ?? null},${opts.discordName},${opts.email ?? null},'paid',now(),now(),now()
    )
    ON CONFLICT(season_key,discord_id) DO UPDATE SET
      discord_name=EXCLUDED.discord_name,
      steam_id=EXCLUDED.steam_id,
      status='approved',
      mp_payment_id=COALESCE(season_official_registrations.mp_payment_id,EXCLUDED.mp_payment_id),
      mp_preference_id=COALESCE(season_official_registrations.mp_preference_id,EXCLUDED.mp_preference_id),
      contact_email=COALESCE(season_official_registrations.contact_email,EXCLUDED.contact_email),
      entry_type='paid',accepted_terms_at=COALESCE(season_official_registrations.accepted_terms_at,now()),
      paid_at=COALESCE(season_official_registrations.paid_at,now()),updated_at=now()
  `);
}

async function dmBuyer(order: PromoOrder): Promise<void> {
  const client = discordClient();
  if (!client) return;
  const user = await client.users.fetch(order.buyer_discord_id).catch(() => null);
  if (!user) return;
  await user.send(
    `🔥 **SUPERCOMBO START DA SEASON APROVADO!**\n\n`+
    `🥇 Seu **VIP Ouro** foi ativado.\n🏆 Sua **inscrição paga na Season** foi confirmada.\n\n`+
    `🎁 Agora envie este link **somente para o seu duo**:\n${giftUrl(order.gift_token)}\n\n`+
    `O link pode ser resgatado uma única vez. Seu duo deverá entrar com o próprio Discord e Steam.`
  ).catch(() => {});
}

async function fulfillBuyer(order: PromoOrder): Promise<boolean> {
  if (order.buyer_fulfilled_at) return true;
  const claimedAt = new Date();
  const claimed: any = await db.execute(sql`
    UPDATE season_start_promo_orders SET buyer_fulfilled_at=${claimedAt},fulfillment_error=NULL,updated_at=now()
    WHERE id=${order.id} AND buyer_fulfilled_at IS NULL RETURNING *
  `);
  const claimedOrder = rows(claimed)[0];
  if (!claimedOrder) return true;
  const client = discordClient();
  if (!client) {
    await db.execute(sql`UPDATE season_start_promo_orders SET buyer_fulfilled_at=NULL,fulfillment_error='Discord indisponível',updated_at=now() WHERE id=${order.id}`);
    return false;
  }
  try {
    await grantVip({ discordUserId: order.buyer_discord_id, steamId: order.buyer_steam_id, tier:"ouro", durationDays:30, source:"purchase", client });
    await seasonEnroll({ discordId:order.buyer_discord_id, discordName:order.buyer_discord_name, steamId:order.buyer_steam_id, email:order.buyer_email, paymentId:order.mp_payment_id, preferenceId:order.mp_preference_id });
    const fresh = { ...order, buyer_fulfilled_at: claimedAt };
    await dmBuyer(fresh);
    logger.info({ promoOrderId:order.id,discordId:order.buyer_discord_id,steamId:order.buyer_steam_id },"Supercombo buyer fulfilled");
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0,500) : "Falha de entrega";
    await db.execute(sql`UPDATE season_start_promo_orders SET buyer_fulfilled_at=NULL,fulfillment_error=${message},updated_at=now() WHERE id=${order.id}`);
    logger.error({ error,promoOrderId:order.id },"Supercombo buyer fulfillment failed");
    return false;
  }
}

async function mpGetPayment(id: string): Promise<MpPayment | null> {
  const token = mpToken(); if (!token) return null;
  const response = await fetch(`${MP_BASE}/v1/payments/${encodeURIComponent(id)}`, { headers:{Authorization:`Bearer ${token}`} });
  if (!response.ok) return null;
  const data = await response.json();
  return data && typeof data === "object" ? data as MpPayment : null;
}

async function mpSearchExternal(ref: string): Promise<MpPayment | null> {
  const token = mpToken(); if (!token) return null;
  const response = await fetch(`${MP_BASE}/v1/payments/search?sort=date_created&criteria=desc&external_reference=${encodeURIComponent(ref)}`, { headers:{Authorization:`Bearer ${token}`} });
  if (!response.ok) return null;
  const data = await response.json() as {results?:MpPayment[]};
  return data.results?.find(p=>String(p.status)==="approved") ?? data.results?.[0] ?? null;
}

export async function processPromoPayment(payment: MpPayment): Promise<boolean> {
  await ensurePromo();
  const paymentId = String(payment.id ?? "");
  const preferenceId = String(payment.preference_id ?? "");
  const externalReference = String(payment.external_reference ?? "");
  const metadata = (payment.metadata ?? {}) as Record<string,unknown>;
  const promoOrderId = Number(metadata.promo_order_id ?? 0);
  let result: any;
  if (promoOrderId > 0) result = await db.execute(sql`SELECT * FROM season_start_promo_orders WHERE id=${promoOrderId} LIMIT 1`);
  else if (paymentId) result = await db.execute(sql`SELECT * FROM season_start_promo_orders WHERE mp_payment_id=${paymentId} LIMIT 1`);
  else if (preferenceId) result = await db.execute(sql`SELECT * FROM season_start_promo_orders WHERE mp_preference_id=${preferenceId} LIMIT 1`);
  else if (externalReference) result = await db.execute(sql`SELECT * FROM season_start_promo_orders WHERE mp_external_reference=${externalReference} LIMIT 1`);
  else return false;
  const order = rows(result)[0];
  if (!order) return false;
  const status = String(payment.status ?? "pending");
  await db.execute(sql`UPDATE season_start_promo_orders SET status=${status},mp_payment_id=${paymentId || order.mp_payment_id},mp_preference_id=${preferenceId || order.mp_preference_id},mp_external_reference=${externalReference || order.mp_external_reference},updated_at=now() WHERE id=${order.id}`);
  if (status === "approved") {
    const fresh = { ...order, status, mp_payment_id:paymentId || order.mp_payment_id, mp_preference_id:preferenceId || order.mp_preference_id, mp_external_reference:externalReference || order.mp_external_reference };
    await fulfillBuyer(fresh);
  }
  return true;
}

async function validateBuyer(req: Request, res: Response): Promise<{discordId:string;discordName:string;steamId:string;email:string}|null> {
  const session = getCommunitySession(req);
  if (!session) { res.status(401).json({error:"Entre com o Discord para comprar o Supercombo."}); return null; }
  const linked = await getLinkedSteamV2(session.userId);
  if (!linked?.steamId) { res.status(409).json({error:"Conecte sua Steam oficial antes de comprar."}); return null; }
  const email = validEmail(req.body?.email);
  if (!email) { res.status(400).json({error:"Informe um e-mail válido."}); return null; }
  return { discordId:session.userId,discordName:session.username,steamId:linked.steamId,email };
}

async function createOrder(input:{discordId:string;discordName:string;steamId:string;email:string;method:string}):Promise<PromoOrder> {
  await ensurePromo();
  const gift = randomBytes(32).toString("base64url");
  const result:any = await db.execute(sql`
    INSERT INTO season_start_promo_orders(gift_token,buyer_discord_id,buyer_discord_name,buyer_steam_id,buyer_email,amount,status,method)
    VALUES(${gift},${input.discordId},${input.discordName},${input.steamId},${input.email},${PRICE},'pending',${input.method}) RETURNING *
  `);
  return rows(result)[0];
}

router.get("/me", async(req,res)=>{
  const session=getCommunitySession(req);
  if(!session)return res.status(401).json({authenticated:false});
  const linked=await getLinkedSteamV2(session.userId);
  const order=await latestBuyerOrder(session.userId);
  return res.json({authenticated:true,discordUserId:session.userId,username:session.username,steamId:linked?.steamId??null,order:order?{id:order.id,status:order.status,method:order.method,fulfilled:Boolean(order.buyer_fulfilled_at),giftUrl:order.status==="approved"&&order.buyer_fulfilled_at?giftUrl(order.gift_token):null,giftRedeemed:Boolean(order.gift_redeemed_at),giftName:order.gift_discord_name??null,error:order.fulfillment_error}:null});
});

router.get("/gift", async(req,res)=>{
  const token=validGift(req.query.gift); if(!token)return res.status(400).json({error:"Link de presente inválido."});
  const order=await orderByGift(token); if(!order)return res.status(404).json({error:"Presente não encontrado."});
  return res.json({approved:order.status==="approved"&&Boolean(order.buyer_fulfilled_at),redeemed:Boolean(order.gift_redeemed_at)});
});

router.post("/pix", async(req,res)=>{
  const input=await validateBuyer(req,res);if(!input)return;
  const order=await createOrder({...input,method:"pix"});
  const token=mpToken();if(!token)return res.status(503).json({error:"Mercado Pago indisponível."});
  const expiration=new Date(Date.now()+30*60_000).toISOString();
  const body={transaction_amount:PRICE,description:"Supercombo Start da Season - 2 VIP Ouro + 2 Inscricoes",payment_method_id:"pix",date_of_expiration:expiration,payer:{email:input.email,first_name:"Comprador",last_name:"GuerraFria"},metadata:{product_type:"season_start_duo",promo_order_id:String(order.id),discord_user_id:input.discordId,steam_id:input.steamId},notification_url:webhookUrl()};
  const response=await fetch(`${MP_BASE}/v1/payments`,{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json","X-Idempotency-Key":`promo-pix-${order.id}`},body:JSON.stringify(body)});
  const data:any=await response.json().catch(()=>({}));
  if(!response.ok||!data?.id||!data?.point_of_interaction?.transaction_data?.qr_code){await db.execute(sql`UPDATE season_start_promo_orders SET status='failed',updated_at=now() WHERE id=${order.id}`);return res.status(502).json({error:"Não foi possível gerar o PIX do Supercombo."});}
  await db.execute(sql`UPDATE season_start_promo_orders SET mp_payment_id=${String(data.id)},updated_at=now() WHERE id=${order.id}`);
  return res.json({orderId:order.id,paymentId:String(data.id),qrCode:data.point_of_interaction.transaction_data.qr_code,qrCodeBase64:data.point_of_interaction.transaction_data.qr_code_base64??"",expiresAt:data.date_of_expiration??expiration});
});

router.post("/card", async(req,res)=>{
  const input=await validateBuyer(req,res);if(!input)return;
  const order=await createOrder({...input,method:"credit_card"});
  const token=mpToken();if(!token)return res.status(503).json({error:"Mercado Pago indisponível."});
  const ref=`promo-season-duo-${order.id}-${Date.now()}`;
  const body={items:[{title:"Supercombo Start da Season - DUO",quantity:1,unit_price:PRICE,currency_id:"BRL"}],metadata:{product_type:"season_start_duo",promo_order_id:String(order.id),discord_user_id:input.discordId,steam_id:input.steamId},notification_url:webhookUrl(),external_reference:ref,back_urls:{success:`${BASE_URL}/promo?payment=success`,pending:`${BASE_URL}/promo?payment=pending`,failure:`${BASE_URL}/promo?payment=failure`},auto_return:"approved"};
  const response=await fetch(`${MP_BASE}/checkout/preferences`,{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify(body)});
  const data:any=await response.json().catch(()=>({}));
  if(!response.ok||!data?.id||!data?.init_point){await db.execute(sql`UPDATE season_start_promo_orders SET status='failed',updated_at=now() WHERE id=${order.id}`);return res.status(502).json({error:"Não foi possível abrir o checkout do cartão."});}
  await db.execute(sql`UPDATE season_start_promo_orders SET mp_preference_id=${String(data.id)},mp_external_reference=${ref},updated_at=now() WHERE id=${order.id}`);
  return res.json({orderId:order.id,checkoutUrl:String(data.init_point)});
});

router.post("/redeem", async(req,res)=>{
  const session=getCommunitySession(req);if(!session)return res.status(401).json({error:"Entre com seu próprio Discord para resgatar."});
  const linked=await getLinkedSteamV2(session.userId);if(!linked?.steamId)return res.status(409).json({error:"Conecte sua própria Steam antes de resgatar."});
  const token=validGift(req.body?.gift);if(!token)return res.status(400).json({error:"Link de presente inválido."});
  const order=await orderByGift(token);if(!order)return res.status(404).json({error:"Presente não encontrado."});
  if(order.status!=="approved"||!order.buyer_fulfilled_at)return res.status(409).json({error:"Este presente ainda não está liberado. O pagamento precisa estar aprovado."});
  if(order.gift_redeemed_at)return res.status(409).json({error:"Este presente já foi resgatado."});
  if(order.buyer_discord_id===session.userId||order.buyer_steam_id===linked.steamId)return res.status(403).json({error:"O comprador não pode resgatar o próprio presente."});
  const claimed:any=await db.execute(sql`UPDATE season_start_promo_orders SET gift_redeemed_at=now(),gift_discord_id=${session.userId},gift_discord_name=${session.username},gift_steam_id=${linked.steamId},fulfillment_error=NULL,updated_at=now() WHERE id=${order.id} AND gift_redeemed_at IS NULL RETURNING *`);
  if(!rows(claimed)[0])return res.status(409).json({error:"Este presente acabou de ser resgatado por outra conta."});
  const client=discordClient();if(!client){await db.execute(sql`UPDATE season_start_promo_orders SET gift_redeemed_at=NULL,gift_discord_id=NULL,gift_discord_name=NULL,gift_steam_id=NULL WHERE id=${order.id}`);return res.status(503).json({error:"Discord temporariamente indisponível. Tente novamente."});}
  try{
    await grantVip({discordUserId:session.userId,steamId:linked.steamId,tier:"ouro",durationDays:30,source:"purchase",client});
    await seasonEnroll({discordId:session.userId,discordName:session.username,steamId:linked.steamId});
    logger.info({promoOrderId:order.id,giftDiscordId:session.userId,giftSteamId:linked.steamId},"Supercombo gift redeemed");
    return res.json({ok:true,message:"VIP Ouro ativado e inscrição paga na Season confirmada!"});
  }catch(error){
    const message=error instanceof Error?error.message.slice(0,500):"Falha no resgate";
    await db.execute(sql`UPDATE season_start_promo_orders SET gift_redeemed_at=NULL,gift_discord_id=NULL,gift_discord_name=NULL,gift_steam_id=NULL,fulfillment_error=${message},updated_at=now() WHERE id=${order.id}`);
    return res.status(500).json({error:"Não foi possível concluir a entrega agora. Nenhum resgate foi consumido; tente novamente."});
  }
});

router.get("/steam/login",(req,res)=>{
  const session=getCommunitySession(req);if(!session)return void res.redirect("/api/admin/auth/login?target=promo");
  const gift=validGift(req.query.gift);
  const returnTo=`${BASE_URL}/api/promo/steam/callback${gift?`?gift=${encodeURIComponent(gift)}`:""}`;
  const q=new URLSearchParams({"openid.ns":"http://specs.openid.net/auth/2.0","openid.mode":"checkid_setup","openid.return_to":returnTo,"openid.realm":BASE_URL,"openid.identity":"http://specs.openid.net/auth/2.0/identifier_select","openid.claimed_id":"http://specs.openid.net/auth/2.0/identifier_select"});
  return void res.redirect(`${STEAM_OPENID}?${q.toString()}`);
});

router.get("/steam/callback",async(req,res)=>{
  const session=getCommunitySession(req);if(!session)return void res.redirect("/api/admin/auth/login?target=promo");
  const gift=validGift(req.query.gift);
  try{
    const params=new URLSearchParams();for(const [key,value] of Object.entries(req.query))if(key.startsWith("openid.")&&typeof value==="string")params.set(key,value);params.set("openid.mode","check_authentication");
    const verify=await fetch(STEAM_OPENID,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:params});const text=await verify.text();if(!verify.ok||!/is_valid\s*:\s*true/i.test(text))throw new Error("Steam não confirmou a autenticação.");
    const claimed=typeof req.query["openid.claimed_id"]==="string"?String(req.query["openid.claimed_id"]):"";const match=claimed.match(/^https?:\/\/steamcommunity\.com\/openid\/id\/(7656119\d{10})\/?$/i);if(!match)throw new Error("SteamID inválido.");
    const saved=await saveLinkedSteamV2(session.userId,match[1]);if(!saved.ok){const message=saved.reason==="discord-linked"?STEAM_LOCKED_NOTICE:"Esta Steam já está vinculada a outra conta do Discord.";return void res.status(409).type("html").send(`<meta name="viewport" content="width=device-width"><body style="background:#08080a;color:white;font-family:system-ui;padding:30px"><h1>Não foi possível vincular</h1><p>${message}</p><a style="color:#f7c948" href="${gift?`/promo/resgatar?gift=${encodeURIComponent(gift)}`:"/promo"}">Voltar</a></body>`);}
    return void res.redirect(gift?`/promo/resgatar?gift=${encodeURIComponent(gift)}&steam=ok`:"/promo?steam=ok");
  }catch(error){logger.error({error,discordUserId:session.userId},"promo steam callback failed");return void res.redirect(gift?`/promo/resgatar?gift=${encodeURIComponent(gift)}&steam=error`:"/promo?steam=error");}
});

async function reconcilePromo():Promise<void>{
  if(reconciling)return;reconciling=true;
  try{
    await ensurePromo();
    const result:any=await db.execute(sql`SELECT * FROM season_start_promo_orders WHERE (status IN ('pending','in_process','approved') AND buyer_fulfilled_at IS NULL) ORDER BY created_at ASC LIMIT 80`);
    for(const order of rows(result)){
      let payment:MpPayment|null=null;
      if(order.mp_payment_id)payment=await mpGetPayment(order.mp_payment_id);
      if(!payment&&order.mp_external_reference)payment=await mpSearchExternal(order.mp_external_reference);
      if(payment)await processPromoPayment(payment);
    }
  }catch(error){logger.error({error},"Supercombo reconciliation failed");}finally{reconciling=false;}
}

export function startPromoReconciler():void{
  if(reconcilerStarted)return;reconcilerStarted=true;
  void ensurePromo().catch(error=>logger.error({error},"Supercombo DB init failed"));
  setTimeout(()=>void reconcilePromo(),12_000);
  setInterval(()=>void reconcilePromo(),30_000);
}

export default router;

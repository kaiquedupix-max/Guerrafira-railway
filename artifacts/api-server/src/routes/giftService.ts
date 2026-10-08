import { createHmac,randomBytes } from "node:crypto";
import { pool,Pool } from "@workspace/db";
import { discordClient } from "../bot/client.js";
import { grantVipProduct,isVipProduct,VIP_PRODUCTS } from "../bot/vipProducts.js";
import { DUO_WINDOW_MS,duoSecret,tokenHash,tokenMatches,claimProblem } from "./duoPolicy.js";
import { storeOrder } from "./storeOrders.js";
import { recordStoreDelivery } from "./storeReceipts.js";
import { logger } from "../lib/logger.js";
let ready:Promise<void>|undefined;
const locks=new Pool({connectionString:process.env.DATABASE_URL,max:3,connectionTimeoutMillis:10_000});
locks.on('error',()=>logger.warn('Gift lock connection failed'));
export function giftToken(id:number,nonce:string){return createHmac('sha256',duoSecret()).update(`gift:${id}:${nonce}`).digest('base64url');}
export function ensureGifts(){return ready??=pool.query(`CREATE TABLE IF NOT EXISTS store_gifts (
  payment_id INTEGER PRIMARY KEY REFERENCES payments(id), nonce TEXT NOT NULL, token_hash TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL, status TEXT NOT NULL DEFAULT 'available' CHECK(status IN ('available','delivering','redeemed')),
  recipient_discord TEXT,recipient_steam TEXT,redeemed_at TIMESTAMPTZ,
  CHECK((recipient_discord IS NULL)=(recipient_steam IS NULL))
)`).then(()=>{}).catch(e=>{ready=undefined;throw e});}
async function locked<T>(id:number,run:(p:any,g:any)=>Promise<T>){
  await ensureGifts();const c=await locks.connect();let acquired=false;
  try{acquired=(await c.query('SELECT pg_try_advisory_lock(120122,$1) AS acquired',[id])).rows[0]?.acquired;
    if(!acquired)throw Error('Entrega em processamento. Tente novamente.');
    const p=(await c.query('SELECT * FROM payments WHERE id=$1',[id])).rows[0];
    if(!p||p.status!=='approved'||!(await storeOrder(id))?.gift)throw Error('Pagamento não aprovado.');
    return await run(p,(await c.query('SELECT * FROM store_gifts WHERE payment_id=$1',[id])).rows[0]);
  }finally{if(acquired)await c.query('SELECT pg_advisory_unlock(120122,$1)',[id]).catch(()=>{});c.release();}
}
export async function fulfillGiftPayment(id:number):Promise<boolean|undefined>{
  if(!(await storeOrder(id))?.gift)return undefined;
  return locked(id,async(p,g)=>{
    if(!g){const nonce=randomBytes(32).toString('hex');await pool.query('INSERT INTO store_gifts(payment_id,nonce,token_hash,expires_at) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[id,nonce,tokenHash(giftToken(id,nonce)),new Date(Date.now()+DUO_WINDOW_MS)]);}
    // This marker means the paid gift was issued; the recipient gets benefits only at claim.
    await pool.query('UPDATE payments SET vip_granted_at=COALESCE(vip_granted_at,now()),updated_at=now() WHERE id=$1',[id]);
    await recordStoreDelivery(id);return true;
  });
}
export async function listGifts(discord:string){
  await ensureGifts();const{rows}=await pool.query(`SELECT p.id,p.vip_tier,p.status AS payment_status,g.* FROM payments p
    JOIN store_gifts g ON g.payment_id=p.id WHERE p.discord_user_id=$1 ORDER BY p.id DESC LIMIT 50`,[discord]);
  return rows.map(r=>({id:r.payment_id,product:isVipProduct(r.vip_tier)?VIP_PRODUCTS[r.vip_tier as keyof typeof VIP_PRODUCTS].name:'VIP',paymentStatus:r.payment_status,
    status:r.status==='available'&&new Date(r.expires_at).getTime()<=Date.now()?'expired':r.status,expiresAt:r.expires_at,
    claimUrl:r.payment_status==='approved'&&r.status==='available'&&new Date(r.expires_at).getTime()>Date.now()?`https://www.guerrafriarust.com.br/api/store/gift/redeem#${giftToken(r.payment_id,r.nonce)}`:null}));
}
export async function inspectGift(token:string){
  await ensureGifts();if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw Error('Link inválido.');
  const r=(await pool.query(`SELECT g.*,p.status AS payment_status,p.vip_tier FROM store_gifts g JOIN payments p ON p.id=g.payment_id WHERE g.token_hash=$1`,[tokenHash(token)])).rows[0];
  if(!r||!tokenMatches(token,r.token_hash)||r.payment_status!=='approved')throw Error('Link inválido ou pagamento indisponível.');return r;
}
export async function claimGift(token:string,discord:string,steam:string){
  const found=await inspectGift(token);return locked(found.payment_id,async(p,g)=>{
    if(!g||!tokenMatches(token,g.token_hash))throw Error('Link inválido.');
    const problem=claimProblem({status:g.status,expires_at:g.expires_at,duo_discord_id:g.recipient_discord,duo_steam_id:g.recipient_steam},p.discord_user_id,p.steam_id,discord,steam);
    if(problem)throw Error(problem.replaceAll('duo','amigo').replaceAll('combo','presente'));
    const tier:unknown=p.vip_tier;const client=discordClient();if(!isVipProduct(tier)||tier==='duo'||!client)throw Error('Entrega indisponível.');
    await pool.query("UPDATE store_gifts SET recipient_discord=$2,recipient_steam=$3,status='delivering' WHERE payment_id=$1",[p.id,discord,steam]);
    await grantVipProduct({paymentId:p.id,discordUserId:discord,steamId:steam,tier,durationDays:30,source:'purchase',client});
    await pool.query("UPDATE store_gifts SET status='redeemed',redeemed_at=now() WHERE payment_id=$1",[p.id]);
  });
}
export function startGiftReconciler(){let running=false;const timer=setInterval(async()=>{if(running)return;running=true;try{
  await ensureGifts();const{rows}=await pool.query("SELECT g.* FROM store_gifts g JOIN payments p ON p.id=g.payment_id WHERE g.status='delivering' AND p.status='approved' LIMIT 40");
  for(const r of rows)await claimGift(giftToken(r.payment_id,r.nonce),r.recipient_discord,r.recipient_steam).catch(()=>{});
}catch{logger.warn('Gift reconciliation will retry');}finally{running=false;}},30_000);timer.unref();}

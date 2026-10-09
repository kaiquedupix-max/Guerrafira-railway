import {pool,Pool} from '@workspace/db';
import {storeOrder} from './storeOrders.js';
import {discordClient} from '../bot/client.js';
import {grantVipProduct,isVipProduct} from '../bot/vipProducts.js';
import {recordStoreDelivery,receiptState} from './storeReceipts.js';
const locks=new Pool({connectionString:process.env.DATABASE_URL,max:3,connectionTimeoutMillis:10_000});
locks.on('error',()=>{});
export async function fulfillStorePayment(id:number):Promise<boolean|undefined>{
 const order=await storeOrder(id);if(!order||order.gift)return undefined;
 const c=await locks.connect();let acquired=false;
 try{
  acquired=(await c.query('SELECT pg_try_advisory_lock(120123,$1) AS acquired',[id])).rows[0]?.acquired;
  if(!acquired)return false;
  const p=(await c.query('SELECT * FROM payments WHERE id=$1',[id])).rows[0];
  if(!p||p.status!=='approved'||!isVipProduct(p.vip_tier)||p.vip_tier==='duo')return false;
  if((await receiptState(id))?.completed_at)return true;
  const client=discordClient();if(!client)return false;
  await grantVipProduct({paymentId:id,discordUserId:p.discord_user_id,steamId:p.steam_id,tier:p.vip_tier,durationDays:30,source:'purchase',client});
  await pool.query('UPDATE payments SET vip_granted_at=COALESCE(vip_granted_at,now()),updated_at=now() WHERE id=$1',[id]);
  await recordStoreDelivery(id);return true;
 }finally{if(acquired)await c.query('SELECT pg_advisory_unlock(120123,$1)',[id]).catch(()=>{});c.release();}
}

import {Router} from 'express';
import {getCommunitySession} from '../admin/communitySession.js';
import {getLinkedSteamV2} from '../bot/utils/linkedSteamV2.js';
import {officialSteam} from './storeSteamAuth.js';
import {inspectGift,claimGift,listGifts} from './giftService.js';
import {renderGiftPage} from '../admin/giftPage.js';
import {isVipProduct,VIP_PRODUCTS} from '../bot/vipProducts.js';
const router=Router();router.use((_req,res,next)=>{res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cache-Control','no-store');next();});
router.get('/redeem',(_req,res)=>res.type('html').send(renderGiftPage()));
router.get('/purchases',async(req,res)=>{const s=getCommunitySession(req);if(!s)return res.status(401).json({error:'Entre com Discord.'});return res.json(await listGifts(s.userId));});
router.post('/inspect',async(req,res)=>{try{const r=await inspectGift(String(req.body?.token||''));return res.json({status:r.status==='available'&&new Date(r.expires_at).getTime()<=Date.now()?'expired':r.status,expiresAt:r.expires_at,product:isVipProduct(r.vip_tier as unknown)?VIP_PRODUCTS[r.vip_tier as keyof typeof VIP_PRODUCTS].name:'VIP'});}catch{return res.status(404).json({error:'Link inválido ou pagamento indisponível.'});}});
router.post('/claim',async(req,res)=>{
  if(req.get('origin')!=='https://www.guerrafriarust.com.br')return res.status(403).json({error:'Origem inválida.'});
  const s=getCommunitySession(req);if(!s)return res.status(401).json({error:'Entre com Discord.'});
  const steam=await getLinkedSteamV2(s.userId);if(!steam?.steamId||!(await officialSteam(s.userId,steam.steamId)))return res.status(409).json({error:'Autentique sua Steam pelo botão oficial.'});
  try{await claimGift(String(req.body?.token||''),s.userId,steam.steamId);return res.json({status:'redeemed'});}
  catch(e){const text=e instanceof Error?e.message:'';return res.status(409).json({error:['comprador','outro amigo','resgatado','expirou','inválido','não aprovado'].some(t=>text.includes(t))?text:'Entrega em processamento. A vaga continua vinculada à sua conta; tentaremos novamente automaticamente.'});}
});export default router;

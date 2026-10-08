import { executeRconCommand } from "../bot/utils/rcon.js";
import { isVipProduct, type VipProduct } from "../bot/vipProducts.js";

export type KitItem = {shortname:string;name:string;amount:number;skin:string;itemId:number;icon:string};
export type StoreKit = {id:string;name:string;tier:string;cooldownSeconds:number;wipeDelaySeconds:number;items:KitItem[]};
const iconBase="https://raw.githubusercontent.com/JustinJAG/RustIcons/main/icons/";
export function parseKitCatalog(raw:string):StoreKit[]{
  if(raw.length>2_000_000)throw Error("Catálogo muito grande");
  const data=JSON.parse(raw);if(data.version!==2||!Array.isArray(data.kits)||data.kits.length>150)throw Error("Plugin incompatível");
  return data.kits.map((k:any)=>{
    if(!k||typeof k.id!=="string"||!Array.isArray(k.items)||k.items.length>1000)throw Error("Kit inválido");
    return {id:k.id.slice(0,100),name:String(k.name).slice(0,120),tier:String(k.tier),
      cooldownSeconds:Math.max(0,Number(k.cooldownSeconds)||0),wipeDelaySeconds:Math.max(0,Number(k.wipeDelaySeconds)||0),
      items:k.items.map((i:any)=>{
        if(!i||!/^[a-z0-9._-]{1,90}$/.test(i.shortname)||!Number.isSafeInteger(i.amount)||i.amount<1)throw Error("Item inválido");
        return {shortname:i.shortname,name:String(i.name||i.shortname).slice(0,160),amount:i.amount,skin:String(i.skin||"0"),itemId:Number(i.itemId)||0,icon:iconBase+encodeURIComponent(i.shortname)+".png"};
      })};
  });
}
let cache:StoreKit[]=[];let updated=0;let pending:Promise<void>|undefined;let lastAttempt=0;
export async function storeKitCatalog(tier:VipProduct){
  if(Date.now()-lastAttempt>30_000){lastAttempt=Date.now();pending=(async()=>{
    const raw=await executeRconCommand("vipkits.catalog");if(!raw)throw Error("RCON indisponível");
    const next=parseKitCatalog(raw);cache=next;updated=Date.now();
  })().catch(()=>{}).finally(()=>{pending=undefined});}
  await pending;
  const wanted=tier==="combo"||tier==="duo"?["bronze","prata","ouro"]:[tier];
  const kits=cache.filter(k=>wanted.includes(k.tier));
  return {kits,updatedAt:updated?new Date(updated).toISOString():null,stale:updated>0&&Date.now()-updated>60_000,
    available:updated>0,complete:wanted.every(t=>kits.some(k=>k.tier===t)),
    message:updated?null:"O catálogo do servidor está temporariamente indisponível. Não exibimos itens estimados."};
}

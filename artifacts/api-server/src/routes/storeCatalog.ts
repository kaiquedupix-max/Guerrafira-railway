import { executeServerRcon } from "../bot/utils/serverRcon.js";
import type { GuerraFriaServerId } from "../core/servers.js";
import { isVipProduct, type VipProduct } from "../bot/vipProducts.js";

export type KitItem = {shortname:string;name:string;amount:number;skin:string;itemId:number;icon:string;inventory:string;includedIn:string;loadedAmmo:number;ammoType:string};
export type StoreKit = {id:string;name:string;tier:string;cooldownSeconds:number;wipeDelaySeconds:number;items:KitItem[]};
const iconBase="https://cdn.rusthelp.com/images/256/";
/** Legacy Duo kit aliases remain usable in-game; display their contents only once. */
export function uniqueStoreKits(kits:StoreKit[]):StoreKit[]{
 const unique=new Map<string,StoreKit>();
 for(const kit of kits){
  const items=kit.items.map(i=>JSON.stringify([i.shortname,i.amount,i.skin,i.inventory,i.includedIn,i.loadedAmmo,i.ammoType])).sort();
  const key=JSON.stringify([kit.tier,kit.cooldownSeconds,items]);
  const existing=unique.get(key);
  // Prefer the primary kit's conservative post-wipe wait over an older alias.
  if(!existing||kit.wipeDelaySeconds>existing.wipeDelaySeconds)unique.set(key,kit);
 }
 return [...unique.values()];
}
export function parseKitCatalog(raw:string):StoreKit[]{
  if(raw.length>2_000_000)throw Error("Catálogo muito grande");
  const data=JSON.parse(raw);if(data.version!==2||!Array.isArray(data.kits)||data.kits.length>150)throw Error("Plugin incompatível");
  return data.kits.map((k:any)=>{
    if(!k||typeof k.id!=="string"||!Array.isArray(k.items)||k.items.length>1000)throw Error("Kit inválido");
    return {id:k.id.slice(0,100),name:String(k.name).slice(0,120),tier:String(k.tier),
      cooldownSeconds:Math.max(0,Number(k.cooldownSeconds)||0),wipeDelaySeconds:Math.max(0,Number(k.wipeDelaySeconds)||0),
      items:k.items.map((i:any)=>{
        if(!i||!/^[a-z0-9._ -]{1,90}$/.test(i.shortname)||!Number.isSafeInteger(i.amount)||i.amount<1)throw Error("Item inválido");
        return {inventory:String(i.inventory||"main").slice(0,20),includedIn:String(i.includedIn||"").slice(0,90),loadedAmmo:Math.max(0,Number(i.loadedAmmo)||0),ammoType:String(i.ammoType||"").slice(0,90),shortname:i.shortname,name:String(i.name||i.shortname).slice(0,160),amount:i.amount,skin:String(i.skin||"0"),itemId:Number(i.itemId)||0,icon:iconBase+encodeURIComponent(i.shortname)+".png"};
      })};
  });
}
const caches = new Map<GuerraFriaServerId,{kits:StoreKit[];updated:number;lastAttempt:number;pending?:Promise<void>}>();
export async function storeKitCatalog(tier:VipProduct,server:GuerraFriaServerId='solo-duo'){
 let state=caches.get(server);if(!state){state={kits:[],updated:0,lastAttempt:0};caches.set(server,state);}
 const entry=state;
 if(Date.now()-entry.lastAttempt>30_000){entry.lastAttempt=Date.now();entry.pending=(async()=>{
   const raw=await executeServerRcon(server,"vipkits.catalog");if(!raw)throw Error("RCON indisponível");
   entry.kits=parseKitCatalog(raw);entry.updated=Date.now();
 })().catch(()=>{}).finally(()=>{entry.pending=undefined});}
 await entry.pending;
 const wanted=tier==="combo"||tier==="duo"?["bronze","prata","ouro"]:[tier];
 const matching=entry.kits.filter(k=>wanted.includes(k.tier));
 const kits=server==='solo-duo'?uniqueStoreKits(matching):matching;
 return {kits,serverId:server,updatedAt:entry.updated?new Date(entry.updated).toISOString():null,stale:entry.updated>0&&Date.now()-entry.updated>60_000,
 available:entry.updated>0,complete:wanted.every(t=>kits.some(k=>k.tier===t)),
 message:entry.updated?null:"O catálogo do servidor está temporariamente indisponível. Não exibimos itens estimados."};
}

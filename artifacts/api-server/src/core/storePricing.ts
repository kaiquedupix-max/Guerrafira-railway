import type { VipProduct } from '../bot/vipProducts.js';
import { isServerPurchasable, type GuerraFriaServerId } from './servers.js';
export type StoreSelection = GuerraFriaServerId | 'both';
export const STORE_PRICES = {
 'solo-duo': {bronze:15,prata:20,ouro:40,combo:70,duo:120},
 trio: {bronze:20,prata:30,ouro:50,combo:93.33,duo:200},
} as const;
const names={bronze:'VIP Bronze',prata:'VIP Prata',ouro:'VIP Ouro',combo:'Pacote VIP Bronze + Prata + Ouro',duo:'Super Combo Duo'};
export function parseStoreSelection(value:unknown):StoreSelection|null{return value==='solo-duo'||value==='trio'||value==='both'?value:null;}
export function selectedServers(selection:StoreSelection):GuerraFriaServerId[]{return selection==='both'?['solo-duo','trio']:[selection];}
export function purchasableSelection(selection:StoreSelection){return selectedServers(selection).every(isServerPurchasable);}
export function selectionName(selection:StoreSelection){return selection==='both'?'Guerra Fria Solo/Duo + Trio':selection==='trio'?'Guerra Fria Trio':'Guerra Fria Solo/Duo';}
export function storeQuote(tier:VipProduct,selection:StoreSelection){
 const subtotalCents=selectedServers(selection).reduce((sum,server)=>sum+Math.round(STORE_PRICES[server][tier]*100),0);
 const price=Math.round(subtotalCents*(selection==='both'?0.9:1))/100;
 return {price,regularPrice:Math.round(subtotalCents*1.2)/100,subtotal:subtotalCents/100,bothDiscount:selection==='both'?10:0,
  name:tier==='duo'?(selection==='both'?'Super Combos Duo + Trio':selection==='trio'?'Super Combo Trio':'Super Combo Duo'):names[tier],
  friendSlots:tier==='duo'?(selection==='solo-duo'?1:2):0};
}
export const STORE_QUOTES=Object.fromEntries((['solo-duo','trio','both'] as const).map(server=>[server,Object.fromEntries((['bronze','prata','ouro','combo','duo'] as const).map(tier=>[tier,storeQuote(tier,server)]))]));

import {storeQuote} from "../core/storePricing.js";
import { and, eq } from "drizzle-orm";
import { db, vipSubscriptionsTable } from "@workspace/db";
import { grantVip, VIP_TIERS, type VipTier } from "./vip.js";
import { storeOrder } from '../routes/storeOrders.js';
import { selectedServers, type StoreSelection } from '../core/storePricing.js';
import type { GuerraFriaServerId } from '../core/servers.js';

export const VIP_PRODUCTS = {
  ...VIP_TIERS,
  combo: { id: "combo", name: "Pacote VIP Bronze + Prata + Ouro", emoji: "🎁", price: 70, color: 0xffd700, benefits: [] as string[] },
  duo: { id: "duo", name: "Super Combo Duo", emoji: "👥", price: 120, color: 0xffd700, benefits: [] as string[] },
} as const;
export type VipProduct = keyof typeof VIP_PRODUCTS;
export function isVipProduct(value: unknown): value is VipProduct {
  return value === "bronze" || value === "prata" || value === "ouro" || value === "combo" || value === "duo";
}

export async function grantVipProduct(opts: Omit<Parameters<typeof grantVip>[0], "tier"> & { tier: VipProduct; paymentId: number; deliveryServers?:GuerraFriaServerId[] }): Promise<void> {
  const order=await storeOrder(opts.paymentId);
  const selection=(order?.server_id||'solo-duo') as StoreSelection;
  const servers=opts.deliveryServers??selectedServers(selection);
  const tiers: VipTier[] = opts.tier === "combo" || opts.tier === "duo" ? ["bronze", "prata", "ouro"] : [opts.tier];
  for(const server of servers){
  const source=selection==='both'?`purchase:${opts.paymentId}:${server}` as const:`purchase:${opts.paymentId}` as const;
  for (const tier of tiers) {
    // Each component is tied to its payment so retries and repeat purchases stay independent.
    const [delivered] = await db.select().from(vipSubscriptionsTable).where(and(
      eq(vipSubscriptionsTable.steamId, opts.steamId),
      eq(vipSubscriptionsTable.discordUserId, opts.discordUserId),
      eq(vipSubscriptionsTable.vipTier, tier),
      eq(vipSubscriptionsTable.source, source),
    )).limit(1);
    if (!delivered) await grantVip({ ...opts, tier, source });
  }
  }
}

export function vipPriceForServer(tier:VipProduct,serverId:GuerraFriaServerId){return storeQuote(tier,serverId).price;}

import { and, eq } from "drizzle-orm";
import { db, vipSubscriptionsTable } from "@workspace/db";
import { grantVip, VIP_TIERS, type VipTier } from "./vip.js";

export const VIP_PRODUCTS = {
  ...VIP_TIERS,
  combo: { id: "combo", name: "Pacote VIP Bronze + Prata + Ouro", emoji: "🎁", price: 70, color: 0xffd700, benefits: [] as string[] },
} as const;
export type VipProduct = keyof typeof VIP_PRODUCTS;
export function isVipProduct(value: unknown): value is VipProduct {
  return value === "bronze" || value === "prata" || value === "ouro" || value === "combo";
}

export async function grantVipProduct(opts: Omit<Parameters<typeof grantVip>[0], "tier"> & { tier: VipProduct; paymentId: number }): Promise<void> {
  if (opts.tier !== "combo") return grantVip({ ...opts, tier: opts.tier });
  const tiers: VipTier[] = ["bronze", "prata", "ouro"];
  for (const tier of tiers) {
    // Each component is tied to its payment so retries and repeat purchases stay independent.
    const [delivered] = await db.select().from(vipSubscriptionsTable).where(and(
      eq(vipSubscriptionsTable.steamId, opts.steamId),
      eq(vipSubscriptionsTable.discordUserId, opts.discordUserId),
      eq(vipSubscriptionsTable.vipTier, tier),
      eq(vipSubscriptionsTable.source, `purchase:${opts.paymentId}`),
    )).limit(1);
    if (!delivered) await grantVip({ ...opts, tier, source: `purchase:${opts.paymentId}` });
  }
}

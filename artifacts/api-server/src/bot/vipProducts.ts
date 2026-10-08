import { and, eq } from "drizzle-orm";
import { db, vipSubscriptionsTable } from "@workspace/db";
import { grantVip, VIP_TIERS, type VipTier } from "./vip.js";

export const VIP_PRODUCTS = {
  ...VIP_TIERS,
  combo: { id: "combo", name: "Pacote VIP Bronze + Prata + Ouro", emoji: "🎁", price: 70, color: 0xffd700, benefits: [] as string[] },
  duo: { id: "duo", name: "Super Combo Duo", emoji: "👥", price: 120, color: 0xffd700, benefits: [] as string[] },
} as const;
export type VipProduct = keyof typeof VIP_PRODUCTS;
export type VipStoreServerId = "solo-duo" | "trio";

export function isVipProduct(value: unknown): value is VipProduct {
  return value === "bronze" || value === "prata" || value === "ouro" || value === "combo" || value === "duo";
}

const PRICE_ENV: Record<VipStoreServerId, Record<VipProduct, string>> = {
  "solo-duo": {
    bronze: "VIP_BRONZE_PRICE",
    prata: "VIP_PRATA_PRICE",
    ouro: "VIP_OURO_PRICE",
    combo: "VIP_COMBO_PRICE",
    duo: "VIP_SUPER_COMBO_DUO_PRICE",
  },
  trio: {
    bronze: "TRIO_VIP_BRONZE_PRICE",
    prata: "TRIO_VIP_PRATA_PRICE",
    ouro: "TRIO_VIP_OURO_PRICE",
    combo: "TRIO_VIP_COMBO_PRICE",
    duo: "TRIO_VIP_SUPER_COMBO_PRICE",
  },
};

function configuredPrice(key: string): number | null {
  const raw = process.env[key]?.trim();
  if (!raw) return null;
  const value = Number(raw.replace(",", "."));
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Store prices are resolved only after a server is selected.
 * Solo/Duo keeps the existing product prices as fallback; Trio intentionally has
 * no fallback so a price must be configured explicitly before launch.
 */
export function vipPriceForServer(tier: VipProduct, serverId: VipStoreServerId): number | null {
  const configured = configuredPrice(PRICE_ENV[serverId][tier]);
  if (configured !== null) return configured;
  return serverId === "solo-duo" ? VIP_PRODUCTS[tier].price : null;
}

export async function grantVipProduct(opts: Omit<Parameters<typeof grantVip>[0], "tier"> & { tier: VipProduct; paymentId: number }): Promise<void> {
  const tiers: VipTier[] = opts.tier === "combo" || opts.tier === "duo" ? ["bronze", "prata", "ouro"] : [opts.tier];
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

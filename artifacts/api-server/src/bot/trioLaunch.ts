import { pool } from "@workspace/db";
import { ensureStoreOrders } from "../routes/storeOrders.js";

// Launch day starts at midnight in Brasília. Later purchases retain their purchase date.
export const TRIO_LAUNCH_AT = new Date("2026-10-14T00:00:00-03:00");
export function vipStartsAt(server: string, now = new Date()): Date {
  return server === "trio" && now < TRIO_LAUNCH_AT ? new Date(TRIO_LAUNCH_AT) : now;
}

/** Atomic and repeatable: only prelaunch paid Trio entitlements are moved. */
export async function repairTrioPrelaunchVips(): Promise<void> {
  await ensureStoreOrders();
  await pool.query(`UPDATE vip_subscriptions v
    SET starts_at=$1, expires_at=$1::timestamp + v.duration_days * interval '1 day'
    WHERE v.created_at < $1 AND v.starts_at < $1
      AND v.source LIKE 'purchase:%'
      AND NOT v.game_vip_removed
      AND (v.source ~ '^purchase:[0-9]+:trio$' OR
        (v.source ~ '^purchase:[0-9]+$' AND EXISTS (
          SELECT 1 FROM store_orders o WHERE o.payment_id::text=split_part(v.source, ':', 2) AND o.server_id='trio'
        )))`, [TRIO_LAUNCH_AT]);
}

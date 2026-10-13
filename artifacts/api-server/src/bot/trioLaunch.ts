import { pool } from "@workspace/db";
import { ensureStoreOrders } from "../routes/storeOrders.js";

// Launch clock starts at 18:30 in Brasília. Later purchases retain their purchase date.
export const TRIO_LAUNCH_AT = new Date("2026-10-14T18:30:00-03:00");
export function vipStartsAt(server: string, now = new Date()): Date {
  return server === "trio" && now < TRIO_LAUNCH_AT ? new Date(TRIO_LAUNCH_AT) : now;
}

/** Atomic and repeatable: only active prelaunch Trio entitlements are moved. */
export async function repairTrioPrelaunchVips(): Promise<void> {
  await ensureStoreOrders();
  await pool.query(`UPDATE vip_subscriptions v
    SET starts_at=$1, expires_at=$1::timestamp + v.duration_days * interval '1 day'
    WHERE v.created_at < $1 AND v.starts_at < $1
      AND NOT v.game_vip_removed
      AND (v.source='manual:trio' OR v.source ~ '^purchase:[0-9]+:trio$' OR
        (v.source ~ '^purchase:[0-9]+$' AND EXISTS (
          SELECT 1 FROM store_orders o WHERE o.payment_id::text=split_part(v.source, ':', 2) AND o.server_id='trio'
        )))`, [TRIO_LAUNCH_AT]);
}

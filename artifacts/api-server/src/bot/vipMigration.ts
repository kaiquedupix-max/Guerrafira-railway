import type { Client } from "discord.js";
import { pool, db, vipSubscriptionsTable } from "@workspace/db";
import { and, eq, gt } from "drizzle-orm";
import { reapplyDuoVip } from "./vip.js";
import { subscriptionServer } from "../routes/storeOrders.js";
import { logger } from "../lib/logger.js";

const JOB = "duo-vipkits-2.1-restore-v1";
let running = false;
/** Durable per-subscription checkpoints resume failures, but completed migration never repeats. */
export async function restoreDuoVipsOnce(client: Client): Promise<boolean> {
  if (running) return false;
  running = true;
  const connection = await pool.connect().catch(error => { running = false; throw error; });
  let locked = false;
  try {
    locked = (await connection.query("SELECT pg_try_advisory_lock(84032017) AS locked")).rows[0].locked;
    if (!locked) return false;
    await connection.query(`CREATE TABLE IF NOT EXISTS bot_entitlement_migrations (
      job TEXT NOT NULL, entitlement TEXT NOT NULL, completed_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(job,entitlement)
    )`);
    if ((await connection.query("SELECT 1 FROM bot_entitlement_migrations WHERE job=$1 AND entitlement='complete'", [JOB])).rowCount) return true;
    const done = new Set((await connection.query("SELECT entitlement FROM bot_entitlement_migrations WHERE job=$1", [JOB])).rows.map(row => row.entitlement));
    const active = await db.select().from(vipSubscriptionsTable).where(and(gt(vipSubscriptionsTable.expiresAt, new Date()), eq(vipSubscriptionsTable.gameVipRemoved, false)));
    let restored = 0, skipped = 0, failed = 0;
    for (const sub of active) {
      if (await subscriptionServer(sub.source) !== "solo-duo") continue;
      const key = `vip:${sub.id}`;
      if (done.has(key)) { skipped++; continue; }
      try {
        if (await reapplyDuoVip(sub.id, client)) restored++;
        await connection.query("INSERT INTO bot_entitlement_migrations(job,entitlement) VALUES($1,$2) ON CONFLICT DO NOTHING", [JOB,key]);
      } catch (error) { failed++; logger.error({ error, subscriptionId: sub.id }, "Duo VIP restoration pending retry; validity unchanged"); }
    }
    if (!failed) await connection.query("INSERT INTO bot_entitlement_migrations(job,entitlement) VALUES($1,'complete') ON CONFLICT DO NOTHING", [JOB]);
    logger.info({ job: JOB, restored, skipped, failed, completed: failed === 0 }, "One-time Duo VIP restoration; original expiry dates retained");
    return failed === 0;
  } finally {
    if (locked) await connection.query("SELECT pg_advisory_unlock(84032017)").catch(() => {});
    connection.release(); running = false;
  }
}
export function startDuoVipRestoration(client: Client): void {
  const timer = setInterval(() => attempt(), 120_000);
  async function attempt() {
    try { if (await restoreDuoVipsOnce(client)) clearInterval(timer); }
    catch (error) { logger.error({ error }, "One-time Duo VIP restoration will retry"); }
  }
  void attempt();
}

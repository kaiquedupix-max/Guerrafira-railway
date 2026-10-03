import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAdmin } from "./guard.js";
import { seasonRegistrationKey } from "../routes/seasonRanks.js";

const router = Router();
router.use(requireAdmin);

async function ensureTable() {
  await db.execute(sql`CREATE TABLE IF NOT EXISTS season_official_registrations (
    season_key INTEGER NOT NULL, discord_id TEXT NOT NULL, discord_name TEXT NOT NULL, steam_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', amount NUMERIC(10,2) NOT NULL DEFAULT 20,
    mp_payment_id TEXT, mp_preference_id TEXT, full_name TEXT, contact_email TEXT,
    prize_pix_type TEXT, prize_pix_key TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    paid_at TIMESTAMPTZ, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(season_key,discord_id)
  )`);
  await db.execute(sql`ALTER TABLE season_official_registrations ADD COLUMN IF NOT EXISTS entry_type TEXT`);
  await db.execute(sql`ALTER TABLE season_official_registrations ADD COLUMN IF NOT EXISTS accepted_terms_at TIMESTAMPTZ`);
}

function parseSeason(value: unknown): 1 | 2 {
  return Number(value) === 1 ? 1 : 2;
}

router.get("/registrations-unified", async (req, res) => {
  try {
    await ensureTable();
    const season = parseSeason(req.query.season);
    const seasonKey = seasonRegistrationKey(season);
    const result: any = await db.execute(sql`
      SELECT season_key,discord_id,discord_name,steam_id,status,amount,
             mp_payment_id,mp_preference_id,full_name,contact_email,
             prize_pix_type,prize_pix_key,entry_type,accepted_terms_at,
             created_at,paid_at,updated_at
        FROM season_official_registrations
       WHERE season_key=${seasonKey}
       ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
                paid_at ASC NULLS LAST,created_at ASC
    `);
    const registrations = (result?.rows || []).map((row: any) => {
      const amount = Number(row.amount || 0);
      const entryType = String(row.entry_type || (amount > 0 ? "paid" : "legacy"));
      const paid = row.status === "active" && amount > 0 && (Boolean(row.paid_at) || Boolean(row.mp_payment_id) || Boolean(row.mp_preference_id));
      return {
        ...row,
        entry_type: entryType,
        paid,
        payment_kind: paid ? "paid" : row.status === "pending" ? "pending" : entryType,
      };
    });
    const paid = registrations.filter((x: any) => x.paid);
    const pending = registrations.filter((x: any) => x.status === "pending");
    const legacyOrFree = registrations.filter((x: any) => !x.paid && (x.entry_type === "free" || Number(x.amount || 0) <= 0));
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    return void res.json({
      ok: true,
      season,
      seasonKey,
      serverId: "solo-duo",
      seasonServerLocked: true,
      freeRegistrationEnabled: false,
      summary: {
        total: registrations.length,
        active: registrations.filter((x: any) => x.status === "active").length,
        paid: paid.length,
        pending: pending.length,
        cancelled: registrations.filter((x: any) => x.status === "cancelled").length,
        legacyOrFree: legacyOrFree.length,
        paidTotal: paid.reduce((sum: number, x: any) => sum + Number(x.amount || 0), 0),
      },
      registrations,
    });
  } catch (error) {
    req.log?.error?.({ error }, "unified season registrations failed");
    return void res.status(500).json({ error: "Falha ao carregar inscrições da Season." });
  }
});

export default router;

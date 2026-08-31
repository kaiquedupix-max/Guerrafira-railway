import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();
const SEASON_KEY = 101;
const BAD_EMAIL = "ezaogg@gmail.com";
const REPAIR_TAG = "2026-08-31-contact-email-incident";

function authorized(req: any): boolean {
  const expected = String(process.env.SEASON_EMAIL_REPAIR_TOKEN || "");
  const supplied = String(req.headers["x-repair-token"] || req.query.token || "");
  return Boolean(expected) && supplied === expected;
}

router.get("/internal/season-email-repair", async (req, res) => {
  if (!authorized(req)) return void res.status(404).json({ error: "not_found" });
  try {
    const affected: any = await db.execute(sql`
      SELECT COUNT(*)::int AS count
      FROM season_official_registrations
      WHERE season_key=${SEASON_KEY} AND lower(contact_email)=${BAD_EMAIL}
    `);
    const alex: any = await db.execute(sql`
      SELECT discord_id,discord_name,full_name,steam_id,contact_email
      FROM season_official_registrations
      WHERE season_key=${SEASON_KEY}
        AND lower(contact_email)=${BAD_EMAIL}
        AND (lower(COALESCE(full_name,'')) LIKE '%alexandre%' OR lower(COALESCE(discord_name,'')) LIKE '%alexandre%')
      ORDER BY updated_at DESC NULLS LAST
    `);
    const recoverable: any = await db.execute(sql`
      SELECT COUNT(*)::int AS count
      FROM season_official_registrations r
      WHERE r.season_key=${SEASON_KEY} AND lower(r.contact_email)=${BAD_EMAIL}
        AND EXISTS (
          SELECT 1 FROM season_email_log l
          WHERE l.season_key=${SEASON_KEY} AND l.discord_id=r.discord_id
            AND lower(l.contact_email)<>${BAD_EMAIL}
            AND l.contact_email IS NOT NULL AND length(trim(l.contact_email))>3
        )
    `);
    const examples: any = await db.execute(sql`
      SELECT r.discord_id,r.discord_name,r.full_name,
             (SELECT l.contact_email FROM season_email_log l
              WHERE l.season_key=${SEASON_KEY} AND l.discord_id=r.discord_id
                AND lower(l.contact_email)<>${BAD_EMAIL}
                AND l.contact_email IS NOT NULL AND length(trim(l.contact_email))>3
              ORDER BY l.sent_at DESC NULLS LAST,l.id DESC LIMIT 1) AS historical_email
      FROM season_official_registrations r
      WHERE r.season_key=${SEASON_KEY} AND lower(r.contact_email)=${BAD_EMAIL}
      ORDER BY r.updated_at DESC NULLS LAST
      LIMIT 10
    `);
    return void res.json({
      ok:true,
      affected:Number(affected?.rows?.[0]?.count||0),
      alexandre_candidates:alex?.rows||[],
      recoverable:Number(recoverable?.rows?.[0]?.count||0),
      examples:examples?.rows||[]
    });
  } catch (error) {
    logger.error({ error }, "Season emergency email repair preview failed");
    return void res.status(500).json({ error: "preview_failed" });
  }
});

router.post("/internal/season-email-repair", async (req, res) => {
  if (!authorized(req)) return void res.status(404).json({ error: "not_found" });
  try {
    const alex: any = await db.execute(sql`
      SELECT discord_id,discord_name,full_name,steam_id,contact_email
      FROM season_official_registrations
      WHERE season_key=${SEASON_KEY}
        AND lower(contact_email)=${BAD_EMAIL}
        AND (lower(COALESCE(full_name,'')) LIKE '%alexandre%' OR lower(COALESCE(discord_name,'')) LIKE '%alexandre%')
      ORDER BY updated_at DESC NULLS LAST
    `);
    const candidates = alex?.rows || [];
    if (candidates.length !== 1) {
      return void res.status(409).json({ error:"alexandre_ambiguous", candidates });
    }
    const alexandreDiscordId = String(candidates[0].discord_id);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS season_email_repair_backup (
        repair_tag TEXT NOT NULL,
        season_key INTEGER NOT NULL,
        discord_id TEXT NOT NULL,
        discord_name TEXT,
        full_name TEXT,
        steam_id TEXT,
        contact_email TEXT,
        backed_up_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY(repair_tag,season_key,discord_id)
      )
    `);
    await db.execute(sql`
      INSERT INTO season_email_repair_backup(repair_tag,season_key,discord_id,discord_name,full_name,steam_id,contact_email)
      SELECT ${REPAIR_TAG},season_key,discord_id,discord_name,full_name,steam_id,contact_email
      FROM season_official_registrations
      WHERE season_key=${SEASON_KEY} AND lower(contact_email)=${BAD_EMAIL}
      ON CONFLICT (repair_tag,season_key,discord_id) DO NOTHING
    `);

    const before: any = await db.execute(sql`
      SELECT COUNT(*)::int AS count
      FROM season_official_registrations
      WHERE season_key=${SEASON_KEY} AND lower(contact_email)=${BAD_EMAIL}
    `);

    const updated: any = await db.execute(sql`
      WITH historical AS (
        SELECT DISTINCT ON (l.discord_id)
          l.discord_id,l.contact_email
        FROM season_email_log l
        WHERE l.season_key=${SEASON_KEY}
          AND lower(l.contact_email)<>${BAD_EMAIL}
          AND l.contact_email IS NOT NULL
          AND length(trim(l.contact_email))>3
        ORDER BY l.discord_id,l.sent_at DESC NULLS LAST,l.id DESC
      )
      UPDATE season_official_registrations r
      SET contact_email=h.contact_email,updated_at=now()
      FROM historical h
      WHERE r.season_key=${SEASON_KEY}
        AND lower(r.contact_email)=${BAD_EMAIL}
        AND r.discord_id=h.discord_id
        AND r.discord_id<>${alexandreDiscordId}
      RETURNING r.discord_id,r.discord_name,r.full_name,r.contact_email
    `);

    const after: any = await db.execute(sql`
      SELECT discord_id,discord_name,full_name,steam_id,contact_email
      FROM season_official_registrations
      WHERE season_key=${SEASON_KEY} AND lower(contact_email)=${BAD_EMAIL}
      ORDER BY updated_at DESC NULLS LAST
    `);

    logger.warn({
      repairTag:REPAIR_TAG,
      before:Number(before?.rows?.[0]?.count||0),
      restored:updated?.rows?.length||0,
      remaining:after?.rows?.length||0,
      alexandreDiscordId
    }, "Season emergency contact email repair executed");

    return void res.json({
      ok:true,
      repair_tag:REPAIR_TAG,
      before:Number(before?.rows?.[0]?.count||0),
      restored:updated?.rows?.length||0,
      alexandre:candidates[0],
      remaining_bad_email:after?.rows||[],
      backup_table:"season_email_repair_backup"
    });
  } catch (error) {
    logger.error({ error }, "Season emergency email repair execution failed");
    return void res.status(500).json({ error:"repair_failed" });
  }
});

export default router;

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";

const SEASON_KEY = 101;
const BAD_EMAIL = "ezaogg@gmail.com";
const REPAIR_TAG = "2026-08-31-contact-email-incident";

export async function runSeasonEmailRepairAutorun(): Promise<void> {
  if (String(process.env.SEASON_EMAIL_REPAIR_AUTORUN || "") !== "1") return;
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
      logger.error({ candidates }, "Season email repair autorun aborted: Alexandre ambiguous");
      return;
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
      SELECT COUNT(*)::int AS count FROM season_official_registrations
      WHERE season_key=${SEASON_KEY} AND lower(contact_email)=${BAD_EMAIL}
    `);

    const updated: any = await db.execute(sql`
      WITH historical AS (
        SELECT DISTINCT ON (l.discord_id) l.discord_id,l.contact_email
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
      repairTag: REPAIR_TAG,
      before: Number(before?.rows?.[0]?.count || 0),
      restored: updated?.rows?.length || 0,
      remaining: after?.rows || [],
      alexandre: candidates[0]
    }, "SEASON_EMAIL_REPAIR_AUTORUN_COMPLETE");
  } catch (error) {
    logger.error({ error }, "SEASON_EMAIL_REPAIR_AUTORUN_FAILED");
  }
}

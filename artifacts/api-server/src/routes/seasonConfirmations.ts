import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { PROD_SEASON_KEY, sendProductionSeasonEmail, type ProdRegistration } from "./seasonProductionEmails.js";

async function ensureDeliveryColumns() {
  await db.execute(sql`ALTER TABLE season_official_registrations ADD COLUMN IF NOT EXISTS confirmation_email_sent_at TIMESTAMPTZ`);
  await db.execute(sql`ALTER TABLE season_official_registrations ADD COLUMN IF NOT EXISTS confirmation_email_status TEXT`);
  await db.execute(sql`ALTER TABLE season_official_registrations ADD COLUMN IF NOT EXISTS confirmation_last_error TEXT`);
  await db.execute(sql`ALTER TABLE season_official_registrations ADD COLUMN IF NOT EXISTS entry_type TEXT NOT NULL DEFAULT 'paid'`);
}

async function getRegistration(discordId: string): Promise<ProdRegistration | null> {
  await ensureDeliveryColumns();
  const r: any = await db.execute(sql`
    SELECT discord_id,discord_name,steam_id,COALESCE(full_name,discord_name) full_name,contact_email,entry_type
    FROM season_official_registrations
    WHERE season_key=${PROD_SEASON_KEY} AND discord_id=${discordId}
    LIMIT 1
  `);
  return r?.rows?.[0] || null;
}

export async function sendSeasonRegistrationConfirmations(discordId: string) {
  const row = await getRegistration(discordId);
  if (!row?.contact_email) return { email: "skipped" };
  try {
    const result = await sendProductionSeasonEmail({ row, template: "confirmation" });
    const status = result.status;
    if (status === "sent") {
      await db.execute(sql`UPDATE season_official_registrations SET confirmation_email_sent_at=now(),confirmation_email_status='sent',confirmation_last_error=NULL WHERE season_key=${PROD_SEASON_KEY} AND discord_id=${discordId}`);
    } else if (status === "simulated") {
      await db.execute(sql`UPDATE season_official_registrations SET confirmation_email_status='simulated',confirmation_last_error=NULL WHERE season_key=${PROD_SEASON_KEY} AND discord_id=${discordId}`);
    }
    return { email: status };
  } catch (error: any) {
    const message = String(error?.message || error).slice(0, 900);
    logger.error({ error, discordId }, "Season confirmation email failed");
    await db.execute(sql`UPDATE season_official_registrations SET confirmation_email_status='failed',confirmation_last_error=${message} WHERE season_key=${PROD_SEASON_KEY} AND discord_id=${discordId}`);
    return { email: "failed" };
  }
}

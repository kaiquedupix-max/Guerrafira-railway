import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";

const OFFICIAL_KEY = 101;
const START = "04/09/2026 às 18:30";
const PRICE = 20;

type Registration = {
  discord_id: string;
  discord_name: string;
  steam_id: string;
  full_name: string;
  contact_email: string;
};

const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, c => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "\"": "&quot;",
  "'": "&#39;",
}[c] || c));

async function ensureDeliveryColumns() {
  await db.execute(sql`ALTER TABLE season_official_registrations ADD COLUMN IF NOT EXISTS confirmation_email_sent_at TIMESTAMPTZ`);
  await db.execute(sql`ALTER TABLE season_official_registrations ADD COLUMN IF NOT EXISTS confirmation_email_status TEXT`);
  await db.execute(sql`ALTER TABLE season_official_registrations ADD COLUMN IF NOT EXISTS confirmation_last_error TEXT`);
}

async function getRegistration(discordId: string): Promise<Registration | null> {
  await ensureDeliveryColumns();
  const r: any = await db.execute(sql`
    SELECT discord_id, discord_name, steam_id, full_name, contact_email
    FROM season_official_registrations
    WHERE season_key=${OFFICIAL_KEY} AND discord_id=${discordId}
    LIMIT 1
  `);
  return r?.rows?.[0] || null;
}

async function sendEmail(row: Registration): Promise<"sent" | "simulated" | "skipped"> {
  const state: any = await db.execute(sql`
    SELECT confirmation_email_sent_at
    FROM season_official_registrations
    WHERE season_key=${OFFICIAL_KEY} AND discord_id=${row.discord_id}
    LIMIT 1
  `);
  if (state?.rows?.[0]?.confirmation_email_sent_at) return "skipped";

  const mode = String(process.env.SEASON_EMAIL_MODE || "simulation").toLowerCase();
  const key = String(process.env.RESEND_API_KEY || "").trim();
  const from = String(process.env.SEASON_EMAIL_FROM || "Guerra Fria Season <season@guerrafriarust.com.br>").trim();

  if (mode !== "live" || !key) {
    logger.info({ discordId: row.discord_id }, "[SIMULACAO] email de confirmacao Season 1");
    await db.execute(sql`
      UPDATE season_official_registrations
      SET confirmation_email_status='simulated', confirmation_last_error=NULL
      WHERE season_key=${OFFICIAL_KEY} AND discord_id=${row.discord_id}
    `);
    return "simulated";
  }

  const html = `<div style="margin:0;background:#090b0e;padding:32px 16px;font-family:Arial,sans-serif;color:#f8fafc"><div style="max-width:640px;margin:auto;background:#11151b;border:1px solid #343a44;border-radius:20px;overflow:hidden"><div style="padding:26px 28px;background:linear-gradient(135deg,#2b0e11,#11151b);border-bottom:1px solid #4b2428"><div style="font-size:12px;font-weight:800;letter-spacing:.12em;color:#f87171">GUERRA FRIA • SEASON 1</div><h1 style="margin:10px 0 6px;font-size:32px">Inscrição confirmada ✅</h1><p style="margin:0;color:#b8bec8">Sua vaga na temporada oficial está ativa.</p></div><div style="padding:28px"><p>Olá, <b>${esc(row.full_name)}</b>!</p><p style="color:#c7cdd5;line-height:1.6">O pagamento de <b style="color:#fbbf24">R$ ${PRICE.toFixed(2).replace('.', ',')}</b> foi confirmado e sua inscrição na Guerra Fria Season 1 está concluída.</p><div style="margin:22px 0;padding:18px;border:1px solid #303741;border-radius:14px;background:#0b0f14;line-height:1.8"><b>Início:</b> ${START}<br><b>Steam:</b> ${esc(row.steam_id)}<br><b>Discord:</b> ${esc(row.discord_name)}</div><p style="color:#aab2bd;line-height:1.6">Guarde este e-mail como comprovante da sua inscrição. Boa sorte na disputa pelo topo. ❄️🏆</p></div></div></div>`;

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [row.contact_email],
      subject: "Inscrição confirmada • Guerra Fria Season 1",
      html,
    }),
  });

  if (!resp.ok) throw new Error(`Resend ${resp.status}: ${(await resp.text()).slice(0, 300)}`);

  await db.execute(sql`
    UPDATE season_official_registrations
    SET confirmation_email_sent_at=now(), confirmation_email_status='sent', confirmation_last_error=NULL
    WHERE season_key=${OFFICIAL_KEY} AND discord_id=${row.discord_id}
  `);
  return "sent";
}

export async function sendSeasonRegistrationConfirmations(discordId: string) {
  const row = await getRegistration(discordId);
  if (!row?.contact_email) return { email: "skipped" };
  try {
    return { email: await sendEmail(row) };
  } catch (error: any) {
    const message = String(error?.message || error).slice(0, 900);
    logger.error({ error, discordId }, "Season confirmation email failed");
    await db.execute(sql`
      UPDATE season_official_registrations
      SET confirmation_email_status='failed', confirmation_last_error=${message}
      WHERE season_key=${OFFICIAL_KEY} AND discord_id=${discordId}
    `);
    return { email: "failed" };
  }
}

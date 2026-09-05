import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { getCommunitySession } from "../admin/communitySession.js";

const router: IRouter = Router();
const SEASON_KEY = 101;
let ensured = false;
let syncStarted = false;

function validEmail(value: unknown): string {
  const v = String(value ?? "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) ? v.slice(0, 160) : "";
}

function validPixType(value: unknown): string {
  const v = String(value ?? "").trim().toLowerCase();
  return ["cpf", "cnpj", "email", "telefone", "aleatoria"].includes(v) ? v : "";
}

function validPixKey(value: unknown): string {
  const v = String(value ?? "").trim();
  return v.length >= 3 && v.length <= 180 ? v : "";
}

async function syncDetailsToSeason(): Promise<void> {
  await db.execute(sql`
    UPDATE season_official_registrations AS r
       SET contact_email=d.email,
           prize_pix_type=d.pix_type,
           prize_pix_key=d.pix_key,
           updated_at=now()
      FROM season_promo_participant_details AS d
     WHERE r.season_key=d.season_key
       AND r.discord_id=d.discord_id
       AND r.season_key=${SEASON_KEY}
       AND (
         r.contact_email IS DISTINCT FROM d.email OR
         r.prize_pix_type IS DISTINCT FROM d.pix_type OR
         r.prize_pix_key IS DISTINCT FROM d.pix_key
       )
  `);
}

function startSync(): void {
  if (syncStarted) return;
  syncStarted = true;
  setInterval(() => void syncDetailsToSeason().catch(() => {}), 5000).unref?.();
}

async function ensureDetails(): Promise<void> {
  if (ensured) return;
  await db.execute(sql`CREATE TABLE IF NOT EXISTS season_promo_participant_details(
    season_key INTEGER NOT NULL,
    discord_id TEXT NOT NULL,
    email TEXT NOT NULL,
    pix_type TEXT NOT NULL,
    pix_key TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'participant',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY(season_key, discord_id)
  )`);
  ensured = true;
  startSync();
  await syncDetailsToSeason();
}

router.post("/details", async (req, res) => {
  const session = getCommunitySession(req);
  if (!session) return res.status(401).json({ error: "Entre com o Discord para registrar os dados da promoção." });

  const email = validEmail(req.body?.email);
  const pixType = validPixType(req.body?.pixType);
  const pixKey = validPixKey(req.body?.pixKey);
  const role = req.body?.role === "gift" ? "gift" : "buyer";

  if (!email) return res.status(400).json({ error: "Informe um e-mail válido." });
  if (!pixType) return res.status(400).json({ error: "Selecione um tipo de chave Pix válido." });
  if (!pixKey) return res.status(400).json({ error: "Informe uma chave Pix válida." });

  await ensureDetails();
  await db.execute(sql`
    INSERT INTO season_promo_participant_details(season_key,discord_id,email,pix_type,pix_key,role,updated_at)
    VALUES(${SEASON_KEY},${session.userId},${email},${pixType},${pixKey},${role},now())
    ON CONFLICT(season_key,discord_id) DO UPDATE SET
      email=EXCLUDED.email,
      pix_type=EXCLUDED.pix_type,
      pix_key=EXCLUDED.pix_key,
      role=EXCLUDED.role,
      updated_at=now()
  `);

  await syncDetailsToSeason();
  return res.json({ ok: true });
});

router.use(["/pix", "/card", "/redeem"], async (req, res, next) => {
  const session = getCommunitySession(req);
  if (!session) return next();
  await ensureDetails();
  const result: any = await db.execute(sql`
    SELECT email,pix_type,pix_key FROM season_promo_participant_details
     WHERE season_key=${SEASON_KEY} AND discord_id=${session.userId} LIMIT 1
  `);
  const details = Array.isArray(result?.rows) ? result.rows[0] : null;
  if (!details?.email || !details?.pix_type || !details?.pix_key) {
    return res.status(400).json({ error: "Informe seu e-mail e sua chave Pix antes de continuar." });
  }
  return next();
});

export default router;

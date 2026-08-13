import { randomUUID } from "node:crypto";
import { Router } from "express";
import { pool } from "@workspace/db";
import { requireAdmin } from "./guard.js";

const router = Router();
router.use(requireAdmin);

function clean(v: unknown, max = 120): string {
  return String(v ?? "").trim().slice(0, max);
}
function money(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 0;
}
function validStatus(v: unknown): string {
  const s = clean(v, 30).toLowerCase();
  return ["approved", "pending", "refunded", "cancelled", "rejected"].includes(s) ? s : "approved";
}

router.get("/finance", async (req, res) => {
  const requested = Number(req.query.days ?? 30);
  const days = Number.isFinite(requested) ? Math.min(3650, Math.max(1, Math.floor(requested))) : 30;
  const status = clean(req.query.status, 30).toLowerCase();
  const tier = clean(req.query.tier, 40).toLowerCase();
  const search = clean(req.query.q, 100);

  const summary = await pool.query(`
    SELECT
      COALESCE(SUM(amount::numeric) FILTER (WHERE status = 'approved'), 0)::float AS revenue,
      COUNT(*) FILTER (WHERE status = 'approved')::int AS sales,
      COALESCE(AVG(amount::numeric) FILTER (WHERE status = 'approved'), 0)::float AS avg_ticket,
      COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
      COALESCE(SUM(amount::numeric) FILTER (WHERE status = 'refunded'), 0)::float AS refunded
    FROM payments
    WHERE created_at >= NOW() - ($1::text || ' days')::interval
  `, [String(days)]);

  const trend = await pool.query(`
    WITH dates AS (
      SELECT generate_series(CURRENT_DATE - ($1::int - 1), CURRENT_DATE, interval '1 day')::date AS day
    ), totals AS (
      SELECT created_at::date AS day,
             COALESCE(SUM(amount::numeric), 0)::float AS revenue,
             COUNT(*)::int AS sales
      FROM payments
      WHERE status = 'approved' AND created_at >= CURRENT_DATE - ($1::int - 1)
      GROUP BY created_at::date
    )
    SELECT to_char(d.day, 'DD/MM') AS label,
           COALESCE(t.revenue, 0)::float AS revenue,
           COALESCE(t.sales, 0)::int AS sales
    FROM dates d LEFT JOIN totals t ON t.day = d.day ORDER BY d.day
  `, [days]);

  const params: unknown[] = [String(days)];
  const where = [`created_at >= NOW() - ($1::text || ' days')::interval`];
  if (status) { params.push(status); where.push(`status = $${params.length}`); }
  if (tier) { params.push(tier); where.push(`LOWER(COALESCE(vip_tier,'')) = $${params.length}`); }
  if (search) {
    params.push(`%${search}%`);
    const p = `$${params.length}`;
    where.push(`(COALESCE(discord_user_id,'') ILIKE ${p} OR COALESCE(steam_id,'') ILIKE ${p} OR COALESCE(vip_tier,'') ILIKE ${p} OR COALESCE(mp_payment_id,'') ILIKE ${p})`);
  }

  const sales = await pool.query(`
    SELECT id, mp_payment_id, discord_user_id, steam_id, vip_tier,
           amount, method, status, created_at,
           CASE WHEN mp_payment_id LIKE 'MANUAL-%' THEN true ELSE false END AS manual
    FROM payments
    WHERE ${where.join(" AND ")}
    ORDER BY created_at DESC
    LIMIT 500
  `, params);

  const tiers = await pool.query(`
    SELECT COALESCE(vip_tier,'Não informado') AS vip_tier,
           COUNT(*)::int AS sales,
           COALESCE(SUM(amount::numeric), 0)::float AS revenue
    FROM payments
    WHERE status = 'approved' AND created_at >= NOW() - ($1::text || ' days')::interval
    GROUP BY vip_tier ORDER BY revenue DESC
  `, [String(days)]);

  res.json({ days, summary: summary.rows[0], trend: trend.rows, sales: sales.rows, tiers: tiers.rows });
});

router.post("/finance/manual", async (req, res) => {
  const amount = money(req.body?.amount);
  const vipTier = clean(req.body?.vipTier, 40) || "manual";
  const discordUserId = clean(req.body?.discordUserId, 40) || null;
  const steamId = clean(req.body?.steamId, 40) || null;
  const method = clean(req.body?.method, 40) || "manual";
  const status = validStatus(req.body?.status);
  const createdAt = clean(req.body?.createdAt, 40);
  const paymentId = `MANUAL-${randomUUID()}`;

  const row = await pool.query(`
    INSERT INTO payments (mp_payment_id, discord_user_id, steam_id, vip_tier, amount, method, status, created_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE(NULLIF($8,'')::timestamptz,NOW()))
    RETURNING id, mp_payment_id, discord_user_id, steam_id, vip_tier, amount, method, status, created_at
  `, [paymentId, discordUserId, steamId, vipTier, amount, method, status, createdAt]);
  res.status(201).json({ ok: true, sale: row.rows[0] });
});

router.patch("/finance/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return void res.status(400).json({ error: "ID inválido" });
  const current = await pool.query(`SELECT * FROM payments WHERE id=$1 LIMIT 1`, [id]);
  if (!current.rowCount) return void res.status(404).json({ error: "Venda não encontrada" });
  const old = current.rows[0];
  const amount = req.body?.amount === undefined ? Number(old.amount) : money(req.body.amount);
  const vipTier = req.body?.vipTier === undefined ? old.vip_tier : (clean(req.body.vipTier, 40) || null);
  const discordUserId = req.body?.discordUserId === undefined ? old.discord_user_id : (clean(req.body.discordUserId, 40) || null);
  const steamId = req.body?.steamId === undefined ? old.steam_id : (clean(req.body.steamId, 40) || null);
  const method = req.body?.method === undefined ? old.method : clean(req.body.method, 40);
  const status = req.body?.status === undefined ? old.status : validStatus(req.body.status);

  const row = await pool.query(`
    UPDATE payments SET amount=$2, vip_tier=$3, discord_user_id=$4, steam_id=$5, method=$6, status=$7
    WHERE id=$1
    RETURNING id, mp_payment_id, discord_user_id, steam_id, vip_tier, amount, method, status, created_at
  `, [id, amount, vipTier, discordUserId, steamId, method, status]);
  res.json({ ok: true, sale: row.rows[0] });
});

router.delete("/finance/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return void res.status(400).json({ error: "ID inválido" });
  const row = await pool.query(`SELECT mp_payment_id FROM payments WHERE id=$1 LIMIT 1`, [id]);
  if (!row.rowCount) return void res.status(404).json({ error: "Lançamento não encontrado" });
  if (!String(row.rows[0].mp_payment_id ?? "").startsWith("MANUAL-")) {
    return void res.status(409).json({ error: "Pagamentos automáticos do Mercado Pago não podem ser apagados; altere o status para cancelado ou reembolsado." });
  }
  await pool.query(`DELETE FROM payments WHERE id=$1`, [id]);
  res.json({ ok: true });
});

export default router;

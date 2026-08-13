import { Router } from "express";
import { pool } from "@workspace/db";
import { requireAdmin } from "./guard.js";

const router = Router();
router.use(requireAdmin);

router.get("/finance", async (req, res) => {
  const requested = Number(req.query.days ?? 30);
  const days = Number.isFinite(requested) ? Math.min(90, Math.max(1, Math.floor(requested))) : 30;

  const summary = await pool.query(`
    SELECT
      COALESCE(SUM(amount::numeric) FILTER (WHERE status = 'approved'), 0)::float AS revenue,
      COUNT(*) FILTER (WHERE status = 'approved')::int AS sales,
      COALESCE(AVG(amount::numeric) FILTER (WHERE status = 'approved'), 0)::float AS avg_ticket,
      COUNT(*) FILTER (WHERE status = 'pending')::int AS pending
    FROM payments
    WHERE created_at >= NOW() - ($1::text || ' days')::interval
  `, [String(days)]);

  const trend = await pool.query(`
    WITH dates AS (
      SELECT generate_series(
        CURRENT_DATE - ($1::int - 1),
        CURRENT_DATE,
        interval '1 day'
      )::date AS day
    ), totals AS (
      SELECT created_at::date AS day,
             COALESCE(SUM(amount::numeric), 0)::float AS revenue,
             COUNT(*)::int AS sales
      FROM payments
      WHERE status = 'approved'
        AND created_at >= CURRENT_DATE - ($1::int - 1)
      GROUP BY created_at::date
    )
    SELECT to_char(d.day, 'DD/MM') AS label,
           COALESCE(t.revenue, 0)::float AS revenue,
           COALESCE(t.sales, 0)::int AS sales
    FROM dates d
    LEFT JOIN totals t ON t.day = d.day
    ORDER BY d.day
  `, [days]);

  const sales = await pool.query(`
    SELECT id, mp_payment_id, discord_user_id, steam_id, vip_tier,
           amount, method, status, created_at
    FROM payments
    WHERE status = 'approved'
      AND created_at >= NOW() - ($1::text || ' days')::interval
    ORDER BY created_at DESC
    LIMIT 200
  `, [String(days)]);

  const tiers = await pool.query(`
    SELECT vip_tier,
           COUNT(*)::int AS sales,
           COALESCE(SUM(amount::numeric), 0)::float AS revenue
    FROM payments
    WHERE status = 'approved'
      AND created_at >= NOW() - ($1::text || ' days')::interval
    GROUP BY vip_tier
    ORDER BY revenue DESC
  `, [String(days)]);

  res.json({
    days,
    summary: summary.rows[0] ?? { revenue: 0, sales: 0, avg_ticket: 0, pending: 0 },
    trend: trend.rows,
    sales: sales.rows,
    tiers: tiers.rows,
  });
});

export default router;

import { randomUUID } from "node:crypto";
import { Router } from "express";
import { pool } from "@workspace/db";
import { requireAdmin } from "./guard.js";

const router = Router();
router.use(requireAdmin);

function clean(v: unknown, max = 120): string { return String(v ?? "").trim().slice(0, max); }
function money(v: unknown): number { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 0; }
function round(v: unknown): number { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0; }
function validStatus(v: unknown): string { const s = clean(v, 30).toLowerCase(); return ["approved","pending","refunded","cancelled","rejected"].includes(s) ? s : "approved"; }

/**
 * Financeiro do painel.
 *
 * IMPORTANTE: esta rota NÃO consulta mais a API do Mercado Pago.
 * A fonte de verdade é o próprio banco do Guerra Fria:
 *   - payments: registra a venda e o valor pago;
 *   - vip_subscriptions: confirma que o VIP correspondente continua ativo.
 *
 * Assim, somente pagamentos aprovados que ainda possuem um VIP ativo entram
 * no cálculo. O filtro de dias é preservado e o gráfico é montado pela data
 * em que cada VIP foi vendido.
 */
router.get("/finance/live", async (req, res) => {
  const requested = Number(req.query.days ?? 30);
  const days = Number.isFinite(requested) ? Math.min(365, Math.max(1, Math.floor(requested))) : 30;

  try {
    const salesResult = await pool.query(`
      SELECT
        p.id,
        p.mp_payment_id,
        p.discord_user_id,
        p.steam_id,
        p.vip_tier,
        p.amount,
        p.method,
        p.status,
        p.created_at,
        p.vip_granted_at
      FROM payments p
      WHERE p.status = 'approved'
        AND p.created_at >= CURRENT_DATE - ($1::int - 1)
        AND EXISTS (
          SELECT 1
          FROM vip_subscriptions v
          WHERE v.expires_at > NOW()
            AND LOWER(v.vip_tier) = LOWER(p.vip_tier)
            AND (
              v.discord_user_id = p.discord_user_id
              OR (
                p.steam_id IS NOT NULL
                AND p.steam_id <> ''
                AND v.steam_id = p.steam_id
              )
            )
        )
      ORDER BY p.created_at DESC
      LIMIT 1000
    `, [days]);

    const activeResult = await pool.query(`
      SELECT COUNT(*)::int AS active_vips
      FROM vip_subscriptions
      WHERE expires_at > NOW()
    `);

    const rows = salesResult.rows || [];
    const total = round(rows.reduce((sum: number, row: any) => sum + Number(row.amount || 0), 0));
    const avgTicket = rows.length ? round(total / rows.length) : 0;

    const trendResult = await pool.query(`
      WITH dates AS (
        SELECT generate_series(
          CURRENT_DATE - ($1::int - 1),
          CURRENT_DATE,
          interval '1 day'
        )::date AS day
      ), totals AS (
        SELECT
          p.created_at::date AS day,
          COALESCE(SUM(p.amount::numeric), 0)::float AS revenue,
          COUNT(*)::int AS sales
        FROM payments p
        WHERE p.status = 'approved'
          AND p.created_at >= CURRENT_DATE - ($1::int - 1)
          AND EXISTS (
            SELECT 1
            FROM vip_subscriptions v
            WHERE v.expires_at > NOW()
              AND LOWER(v.vip_tier) = LOWER(p.vip_tier)
              AND (
                v.discord_user_id = p.discord_user_id
                OR (
                  p.steam_id IS NOT NULL
                  AND p.steam_id <> ''
                  AND v.steam_id = p.steam_id
                )
              )
          )
        GROUP BY p.created_at::date
      )
      SELECT
        to_char(d.day, 'YYYY-MM-DD') AS day,
        COALESCE(t.revenue, 0)::float AS revenue,
        COALESCE(t.sales, 0)::int AS sales
      FROM dates d
      LEFT JOIN totals t ON t.day = d.day
      ORDER BY d.day
    `, [days]);

    const trend = trendResult.rows.map((row: any) => ({
      day: row.day,
      entries: round(row.revenue),
      exits: 0,
      net: round(row.revenue),
      sales: Number(row.sales || 0),
    }));

    const payments = rows.map((row: any) => {
      const amount = round(row.amount);
      const tier = String(row.vip_tier || "VIP").toUpperCase();
      return {
        id: String(row.id),
        paymentId: row.mp_payment_id ? String(row.mp_payment_id) : null,
        status: "approved",
        statusDetail: "vip_active",
        direction: "in",
        movement: "Venda de VIP",
        amount,
        signedAmount: amount,
        grossAmount: amount,
        netAmount: amount,
        fees: 0,
        refunded: 0,
        currency: "BRL",
        method: row.method ? String(row.method) : "Venda registrada",
        methodId: row.method ? String(row.method) : "local",
        type: "vip_sale",
        operationType: "vip_sale",
        description: `VIP ${tier}`,
        externalReference: "",
        dateCreated: row.created_at,
        dateApproved: row.vip_granted_at || row.created_at,
        discordUserId: row.discord_user_id ? String(row.discord_user_id) : "",
        steamId: row.steam_id ? String(row.steam_id) : "",
        vipTier: String(row.vip_tier || ""),
      };
    });

    res.setHeader("Cache-Control", "no-store");
    res.json({
      source: "local_active_vips",
      days,
      report: {
        status: "ready",
        complete: true,
        detail: "Calculado localmente a partir dos VIPs ativos; nenhuma consulta ao Mercado Pago é realizada.",
      },
      account: {
        id: "guerra-fria-vips",
        nickname: "VIPs ativos",
        balance: total,
        balanceAvailable: true,
        balanceType: "active_vip_sales",
        activeVips: Number(activeResult.rows?.[0]?.active_vips || 0),
      },
      summary: {
        grossRevenue: total,
        netRevenue: total,
        expenses: 0,
        fees: 0,
        refunded: 0,
        cashFlow: total,
        approved: rows.length,
        outgoings: 0,
        total: rows.length,
        avgTicket,
        activeVips: Number(activeResult.rows?.[0]?.active_vips || 0),
      },
      trend,
      payments,
    });
  } catch (error: any) {
    console.error("[finance] Falha ao calcular VIPs ativos:", error);
    res.status(500).json({ error: "Não foi possível calcular o financeiro dos VIPs ativos." });
  }
});

router.get("/finance", async (req, res) => {
  const requested = Number(req.query.days ?? 30); const days = Number.isFinite(requested) ? Math.min(3650, Math.max(1, Math.floor(requested))) : 30;
  const status = clean(req.query.status,30).toLowerCase(), tier = clean(req.query.tier,40).toLowerCase(), search = clean(req.query.q,100);
  const summary = await pool.query(`SELECT COALESCE(SUM(amount::numeric) FILTER (WHERE status='approved'),0)::float AS revenue, COUNT(*) FILTER (WHERE status='approved')::int AS sales, COALESCE(AVG(amount::numeric) FILTER (WHERE status='approved'),0)::float AS avg_ticket, COUNT(*) FILTER (WHERE status='pending')::int AS pending, COALESCE(SUM(amount::numeric) FILTER (WHERE status='refunded'),0)::float AS refunded FROM payments WHERE created_at >= NOW() - ($1::text || ' days')::interval`, [String(days)]);
  const trend = await pool.query(`WITH dates AS (SELECT generate_series(CURRENT_DATE-($1::int-1),CURRENT_DATE,interval '1 day')::date AS day), totals AS (SELECT created_at::date AS day,COALESCE(SUM(amount::numeric),0)::float AS revenue,COUNT(*)::int AS sales FROM payments WHERE status='approved' AND created_at>=CURRENT_DATE-($1::int-1) GROUP BY created_at::date) SELECT to_char(d.day,'DD/MM') AS label,COALESCE(t.revenue,0)::float AS revenue,COALESCE(t.sales,0)::int AS sales FROM dates d LEFT JOIN totals t ON t.day=d.day ORDER BY d.day`, [days]);
  const params: unknown[]=[String(days)]; const where=[`created_at >= NOW() - ($1::text || ' days')::interval`];
  if(status){params.push(status);where.push(`status = $${params.length}`)} if(tier){params.push(tier);where.push(`LOWER(COALESCE(vip_tier,'')) = $${params.length}`)} if(search){params.push(`%${search}%`);const p=`$${params.length}`;where.push(`(COALESCE(discord_user_id,'') ILIKE ${p} OR COALESCE(steam_id,'') ILIKE ${p} OR COALESCE(vip_tier,'') ILIKE ${p} OR COALESCE(mp_payment_id,'') ILIKE ${p})`)}
  const sales=await pool.query(`SELECT id,mp_payment_id,discord_user_id,steam_id,vip_tier,amount,method,status,created_at,CASE WHEN mp_payment_id LIKE 'MANUAL-%' THEN true ELSE false END AS manual FROM payments WHERE ${where.join(" AND ")} ORDER BY created_at DESC LIMIT 500`,params);
  const tiers=await pool.query(`SELECT COALESCE(vip_tier,'Não informado') AS vip_tier,COUNT(*)::int AS sales,COALESCE(SUM(amount::numeric),0)::float AS revenue FROM payments WHERE status='approved' AND created_at>=NOW()-($1::text||' days')::interval GROUP BY vip_tier ORDER BY revenue DESC`,[String(days)]);
  res.json({days,summary:summary.rows[0],trend:trend.rows,sales:sales.rows,tiers:tiers.rows});
});

router.post("/finance/manual", async (req,res)=>{const amount=money(req.body?.amount),vipTier=clean(req.body?.vipTier,40)||"manual",discordUserId=clean(req.body?.discordUserId,40)||null,steamId=clean(req.body?.steamId,40)||null,method=clean(req.body?.method,40)||"manual",status=validStatus(req.body?.status),createdAt=clean(req.body?.createdAt,40),paymentId=`MANUAL-${randomUUID()}`;const row=await pool.query(`INSERT INTO payments (mp_payment_id,discord_user_id,steam_id,vip_tier,amount,method,status,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE(NULLIF($8,'')::timestamptz,NOW())) RETURNING id,mp_payment_id,discord_user_id,steam_id,vip_tier,amount,method,status,created_at`,[paymentId,discordUserId,steamId,vipTier,amount,method,status,createdAt]);res.status(201).json({ok:true,sale:row.rows[0]})});
router.patch("/finance/:id", async(req,res)=>{const id=Number(req.params.id);if(!Number.isInteger(id)||id<=0)return void res.status(400).json({error:"ID inválido"});const current=await pool.query(`SELECT * FROM payments WHERE id=$1 LIMIT 1`,[id]);if(!current.rowCount)return void res.status(404).json({error:"Venda não encontrada"});const old=current.rows[0];const amount=req.body?.amount===undefined?Number(old.amount):money(req.body.amount),vipTier=req.body?.vipTier===undefined?old.vip_tier:(clean(req.body.vipTier,40)||null),discordUserId=req.body?.discordUserId===undefined?old.discord_user_id:(clean(req.body.discordUserId,40)||null),steamId=req.body?.steamId===undefined?old.steam_id:(clean(req.body.steamId,40)||null),method=req.body?.method===undefined?old.method:clean(req.body.method,40),status=req.body?.status===undefined?old.status:validStatus(req.body.status);const row=await pool.query(`UPDATE payments SET amount=$2,vip_tier=$3,discord_user_id=$4,steam_id=$5,method=$6,status=$7 WHERE id=$1 RETURNING id,mp_payment_id,discord_user_id,steam_id,vip_tier,amount,method,status,created_at`,[id,amount,vipTier,discordUserId,steamId,method,status]);res.json({ok:true,sale:row.rows[0]})});
router.delete("/finance/:id", async(req,res)=>{const id=Number(req.params.id);if(!Number.isInteger(id)||id<=0)return void res.status(400).json({error:"ID inválido"});const row=await pool.query(`SELECT mp_payment_id FROM payments WHERE id=$1 LIMIT 1`,[id]);if(!row.rowCount)return void res.status(404).json({error:"Lançamento não encontrado"});if(!String(row.rows[0].mp_payment_id??"").startsWith("MANUAL-"))return void res.status(409).json({error:"Pagamentos automáticos não podem ser apagados; altere o status."});await pool.query(`DELETE FROM payments WHERE id=$1`,[id]);res.json({ok:true})});

export default router;

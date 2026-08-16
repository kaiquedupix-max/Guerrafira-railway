import { randomUUID } from "node:crypto";
import { Router } from "express";
import { pool } from "@workspace/db";
import { requireAdmin } from "./guard.js";

const router = Router();
router.use(requireAdmin);
function clean(v: unknown, max = 120): string { return String(v ?? "").trim().slice(0, max); }
function money(v: unknown): number { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 0; }
function validStatus(v: unknown): string { const s = clean(v, 30).toLowerCase(); return ["approved","pending","refunded","cancelled","rejected"].includes(s) ? s : "approved"; }

const methodLabels: Record<string, string> = {
  account_money: "Saldo Mercado Pago", pix: "PIX", credit_card: "Cartão de crédito",
  debit_card: "Cartão de débito", ticket: "Boleto", bank_transfer: "Transferência bancária",
};

async function mpJson(url: string, accessToken: string): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" }, signal: controller.signal });
    const text = await response.text();
    let data: any = {}; try { data = text ? JSON.parse(text) : {}; } catch { data = {}; }
    if (!response.ok) throw Object.assign(new Error(`Mercado Pago respondeu ${response.status}.`), { status: response.status, detail: text.slice(0, 300) });
    return data;
  } finally { clearTimeout(timeout); }
}

function round(value: number): number { return Math.round((Number(value) || 0) * 100) / 100; }

async function searchMpPayments(opts: { accessToken: string; accountId: string; begin: Date; end: Date; role: "collector" | "payer" }): Promise<any[]> {
  const rows: any[] = [];
  for (let page = 0; page < 40; page++) {
    const qs = new URLSearchParams({
      sort: "date_created", criteria: "desc", range: "date_created",
      begin_date: opts.begin.toISOString(), end_date: opts.end.toISOString(),
      limit: "50", offset: String(page * 50),
      [`${opts.role}.id`]: opts.accountId,
    });
    const data = await mpJson(`https://api.mercadopago.com/v1/payments/search?${qs.toString()}`, opts.accessToken);
    const pageRows = Array.isArray(data?.results) ? data.results : [];
    rows.push(...pageRows);
    if (pageRows.length < 50) break;
  }
  return rows;
}

router.get("/finance/live", async (req, res) => {
  const accessToken = (process.env.MERCADO_PAGO_ACCESS_TOKEN || process.env.MP_ACCESS_TOKEN || process.env.MERCADOPAGO_ACCESS_TOKEN || "").trim();
  if (!accessToken) return void res.status(503).json({ error: "MERCADO_PAGO_ACCESS_TOKEN no está configurado en Railway." });
  const requested = Number(req.query.days ?? 30);
  const days = Number.isFinite(requested) ? Math.min(365, Math.max(1, Math.floor(requested))) : 30;
  const end = new Date(); const begin = new Date(Date.now() - (days - 1) * 86400000);
  // A busca de pagamentos disponibiliza até os últimos 12 meses. Usamos todo
  // esse histórico para calcular o saldo, independentemente do filtro da tela.
  const historyBegin = new Date(Date.now() - 364 * 86400000);
  let account: any;
  try { account = await mpJson("https://api.mercadopago.com/users/me", accessToken); }
  catch (error: any) { return void res.status(502).json({ error: error?.message || "Não foi possível identificar a conta Mercado Pago.", detail: error?.detail }); }
  const accountId = String(account?.id ?? "");
  let receivedRows: any[] = [], paidRows: any[] = [];
  try {
    [receivedRows, paidRows] = await Promise.all([
      searchMpPayments({ accessToken, accountId, begin: historyBegin, end, role: "collector" }),
      searchMpPayments({ accessToken, accountId, begin: historyBegin, end, role: "payer" }).catch(() => []),
    ]);
  } catch (error: any) {
    return void res.status(502).json({ error: error?.message || "Falha ao consultar movimentações.", detail: error?.detail });
  }
  const all = Array.from(new Map([...receivedRows, ...paidRows].map(row => [String(row.id), row])).values());
  const payments = all.map(p => {
    const collectorId = String(p.collector_id ?? p.collector?.id ?? "");
    const payerId = String(p.payer?.id ?? "");
    const incoming = Boolean(accountId && collectorId === accountId);
    const outgoing = Boolean(accountId && payerId === accountId && collectorId !== accountId);
    const amount = Number(p.transaction_amount ?? 0);
    const refunded = Number(p.transaction_amount_refunded ?? 0);
    const totalPaid = Number(p.transaction_details?.total_paid_amount ?? amount);
    const feeDetails = Array.isArray(p.fee_details) ? p.fee_details : [];
    const explicitFees = feeDetails.reduce((sum: number, fee: any) => sum + Math.abs(Number(fee?.amount ?? 0)), 0);
    const apiNet = Number(p.transaction_details?.net_received_amount);
    const fees = incoming ? round(explicitFees || (Number.isFinite(apiNet) && apiNet > 0 ? Math.max(0, amount - refunded - apiNet) : 0)) : 0;
    const net = incoming ? round(Number.isFinite(apiNet) && apiNet > 0 ? apiNet - refunded : amount - refunded - fees) : 0;
    const direction = outgoing ? "out" : incoming ? "in" : "other";
    const methodId = String(p.payment_method_id ?? p.payment_type_id ?? "other");
    const method = outgoing && methodId === "account_money" ? "Débito no saldo" : (methodLabels[methodId] || methodId.replaceAll("_", " "));
    return {
      id: String(p.id ?? ""), status: String(p.status ?? ""), statusDetail: String(p.status_detail ?? ""),
      direction, movement: direction === "out" ? "Saída" : direction === "in" ? "Entrada" : "Movimentação",
      amount: round(amount), signedAmount: round(direction === "out" ? -totalPaid : net), grossAmount: round(amount), netAmount: net,
      fees, refunded: round(refunded), currency: String(p.currency_id ?? "BRL"), method, methodId,
      type: String(p.payment_type_id ?? "—"), operationType: String(p.operation_type ?? ""),
      description: String(p.description ?? p.external_reference ?? (direction === "out" ? "Compra" : "Recebimento Mercado Pago")),
      externalReference: String(p.external_reference ?? ""), dateCreated: p.date_created ?? null, dateApproved: p.date_approved ?? null,
      payer: p.payer?.email ? String(p.payer.email) : "", collectorId, payerId,
    };
  });
  const historyApproved = payments.filter(p => p.status === "approved");
  const historyEntries = historyApproved.filter(p => p.direction === "in");
  const historyExits = historyApproved.filter(p => p.direction === "out");
  const calculatedBalance = round(
    historyEntries.reduce((sum, p) => sum + p.netAmount, 0) -
    historyExits.reduce((sum, p) => sum + Math.abs(p.signedAmount), 0),
  );
  const periodStart = begin.getTime();
  const periodPayments = payments.filter(p => {
    const timestamp = new Date(p.dateApproved || p.dateCreated || 0).getTime();
    return Number.isFinite(timestamp) && timestamp >= periodStart;
  });
  const approved = periodPayments.filter(p => p.status === "approved");
  const entries = approved.filter(p => p.direction === "in");
  const exits = approved.filter(p => p.direction === "out");
  const grossRevenue = round(entries.reduce((s, p) => s + p.grossAmount, 0));
  const fees = round(entries.reduce((s, p) => s + p.fees, 0));
  const refunded = round(entries.reduce((s, p) => s + p.refunded, 0));
  const netRevenue = round(entries.reduce((s, p) => s + p.netAmount, 0));
  const expenses = round(exits.reduce((s, p) => s + Math.abs(p.signedAmount), 0));
  const cashFlow = round(netRevenue - expenses);
  const trendMap = new Map<string, { entries: number; exits: number; net: number }>();
  for (let i = 0; i < days; i++) { const d = new Date(begin.getTime() + i * 86400000); trendMap.set(d.toISOString().slice(0,10), { entries: 0, exits: 0, net: 0 }); }
  for (const p of approved) {
    const key = String(p.dateApproved || p.dateCreated || "").slice(0, 10); const day = trendMap.get(key); if (!day) continue;
    if (p.direction === "in") day.entries += p.netAmount;
    if (p.direction === "out") day.exits += Math.abs(p.signedAmount);
    day.net = day.entries - day.exits;
  }
  const trend = Array.from(trendMap.entries()).map(([day, values]) => ({ day, entries: round(values.entries), exits: round(values.exits), net: round(values.net) }));
  res.json({
    source: "mercado_pago", days,
    account: { id: accountId, nickname: account?.nickname ?? null, balance: calculatedBalance, balanceAvailable: true, balanceType: "calculated", historyDays: 365 },
    summary: { grossRevenue, netRevenue, expenses, fees, refunded, cashFlow, approved: entries.length, outgoings: exits.length, total: periodPayments.length, avgTicket: entries.length ? round(grossRevenue / entries.length) : 0 },
    trend, payments: periodPayments.filter(p => p.direction !== "other").slice(0, 500),
  });
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
router.delete("/finance/:id", async(req,res)=>{const id=Number(req.params.id);if(!Number.isInteger(id)||id<=0)return void res.status(400).json({error:"ID inválido"});const row=await pool.query(`SELECT mp_payment_id FROM payments WHERE id=$1 LIMIT 1`,[id]);if(!row.rowCount)return void res.status(404).json({error:"Lançamento não encontrado"});if(!String(row.rows[0].mp_payment_id??"").startsWith("MANUAL-"))return void res.status(409).json({error:"Pagamentos automáticos do Mercado Pago não podem ser apagados; altere o status."});await pool.query(`DELETE FROM payments WHERE id=$1`,[id]);res.json({ok:true})});
export default router;

import { Router } from "express";
import { pool } from "@workspace/db";
import { requireAdmin } from "./guard.js";

const router = Router();
router.use(requireAdmin);

router.get("/revenue-view", async (req, res) => {
  const d = Number(req.query.days ?? 30);
  const days = [7,15,30,60,90].includes(d) ? d : 30;
  const q = await pool.query(`SELECT created_at::date day, SUM(amount::numeric)::float revenue, COUNT(*)::int sales FROM payments WHERE status='approved' AND created_at>=CURRENT_DATE-($1::int-1) GROUP BY created_at::date ORDER BY day`, [days]);
  const all = await pool.query(`SELECT created_at,vip_tier,amount,method,discord_user_id,steam_id FROM payments WHERE status='approved' AND created_at>=NOW()-($1::text||' days')::interval ORDER BY created_at DESC LIMIT 100`, [String(days)]);
  const revenue = all.rows.reduce((n,r)=>n+Number(r.amount||0),0);
  const max = Math.max(1,...q.rows.map(r=>Number(r.revenue||0)));
  const bars = q.rows.map((r,i)=>`<div style="flex:1;min-width:8px;background:#8b5cf6;height:${Math.max(3,Number(r.revenue||0)/max*180)}px" title="${r.day}: R$ ${Number(r.revenue).toFixed(2)}"></div>`).join('');
  const rows = all.rows.map(r=>`<tr><td>${new Date(r.created_at).toLocaleDateString('pt-BR')}</td><td>${String(r.vip_tier||'').toUpperCase()}</td><td>R$ ${Number(r.amount).toFixed(2)}</td><td>${r.method||'—'}</td><td>${r.discord_user_id}</td><td>${r.steam_id||'—'}</td></tr>`).join('');
  const filters=[7,15,30,60,90].map(x=>`<a href="/api/admin/revenue-view?days=${x}" style="padding:9px 12px;border:1px solid #382a4b;border-radius:9px;color:white;text-decoration:none;${x===days?'background:#6d28d9':''}">${x} dias</a>`).join(' ');
  res.type('html').send(`<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;background:#08060d;color:#fff;font-family:system-ui"><main style="max-width:1100px;margin:auto;padding:22px"><a href="/admin" style="color:#ffd84d">← Voltar ao painel</a><h1>💰 Financeiro • Guerra Fria</h1><div style="display:flex;gap:8px;overflow:auto">${filters}</div><section style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:18px 0"><div style="padding:18px;background:#120e1a;border:1px solid #2c2340;border-radius:14px"><small>FATURAMENTO</small><h2 style="color:#ffd84d">R$ ${revenue.toFixed(2)}</h2></div><div style="padding:18px;background:#120e1a;border:1px solid #2c2340;border-radius:14px"><small>VIPS VENDIDOS</small><h2>${all.rows.length}</h2></div><div style="padding:18px;background:#120e1a;border:1px solid #2c2340;border-radius:14px"><small>TICKET MÉDIO</small><h2>R$ ${(all.rows.length?revenue/all.rows.length:0).toFixed(2)}</h2></div></section><section style="background:#120e1a;border:1px solid #2c2340;border-radius:14px;padding:18px"><h3>📈 Faturamento diário</h3><div style="height:190px;display:flex;align-items:flex-end;gap:5px">${bars}</div></section><section style="background:#120e1a;border:1px solid #2c2340;border-radius:14px;padding:18px;margin-top:14px;overflow:auto"><h3>💳 VIPs vendidos</h3><table style="width:100%;border-collapse:collapse"><tr><th>Data</th><th>VIP</th><th>Valor</th><th>Método</th><th>Discord</th><th>SteamID</th></tr>${rows}</table></section></main></body></html>`);
});

export default router;

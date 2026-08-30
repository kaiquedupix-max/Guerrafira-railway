import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAdmin } from "./guard.js";
import { getAdminSessionV3 } from "./sessionBearer.js";
import {
  SEASON_OFFICIAL_KEY,
  buildSeasonEmail,
  ensureSeasonEmailInfrastructure,
  seasonEmailMode,
  sendSeasonEmail,
  type SeasonEmailRegistration,
  type SeasonEmailTemplate,
} from "../routes/seasonEmailService.js";
import { dispatchSeasonLifecycleEmail, getSeasonFinalWinners } from "../routes/seasonEmailLifecycle.js";

const router = Router();
router.use(requireAdmin);

const templateLabels: Record<SeasonEmailTemplate, string> = {
  confirmation: "Confirmação de inscrição",
  rules: "Lembrete de regulamento",
  start: "Início oficial da Season",
  end: "Encerramento e campeões",
};

async function ensureOfficialTable() {
  await db.execute(sql`CREATE TABLE IF NOT EXISTS season_official_registrations (
    season_key INTEGER NOT NULL,discord_id TEXT NOT NULL,discord_name TEXT NOT NULL,steam_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',amount NUMERIC(10,2) NOT NULL DEFAULT 20,mp_payment_id TEXT,mp_preference_id TEXT,
    full_name TEXT,contact_email TEXT,prize_pix_type TEXT,prize_pix_key TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    paid_at TIMESTAMPTZ,updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),PRIMARY KEY(season_key,discord_id))`);
  for (const c of ["confirmation_email_sent_at TIMESTAMPTZ","confirmation_email_status TEXT","confirmation_last_error TEXT"]) {
    await db.execute(sql.raw(`ALTER TABLE season_official_registrations ADD COLUMN IF NOT EXISTS ${c}`));
  }
  await db.execute(sql`CREATE TABLE IF NOT EXISTS season_admin_actions (
    id BIGSERIAL PRIMARY KEY,season_key INTEGER NOT NULL,admin_name TEXT NOT NULL,action TEXT NOT NULL,discord_id TEXT,details TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
}

function adminName(req: any) { return getAdminSessionV3(req)?.username || "Administrador"; }
function isTemplate(v: unknown): v is SeasonEmailTemplate { return ["confirmation","rules","start","end"].includes(String(v)); }
function csvCell(v: unknown) { const s = String(v ?? ""); return `"${s.replace(/"/g, '""')}"`; }

async function getRow(discordId: string): Promise<SeasonEmailRegistration | null> {
  const r: any = await db.execute(sql`SELECT discord_id,discord_name,steam_id,COALESCE(full_name,discord_name) full_name,contact_email FROM season_official_registrations WHERE season_key=${SEASON_OFFICIAL_KEY} AND discord_id=${discordId} LIMIT 1`);
  return r?.rows?.[0] || null;
}

router.get("/official-registrations", async (req, res) => {
  try {
    await ensureOfficialTable(); await ensureSeasonEmailInfrastructure();
    const r: any = await db.execute(sql`SELECT season_key,discord_id,discord_name,steam_id,status,amount,mp_payment_id,mp_preference_id,full_name,contact_email,prize_pix_type,prize_pix_key,created_at,paid_at,updated_at,confirmation_email_status,confirmation_email_sent_at,confirmation_last_error FROM season_official_registrations WHERE season_key=${SEASON_OFFICIAL_KEY} ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,paid_at ASC NULLS LAST,created_at ASC`);
    const rows = Array.isArray(r?.rows) ? r.rows : [];
    const active = rows.filter((x: any) => x.status === "active");
    const paidTotal = active.reduce((a: number, x: any) => a + Number(x.amount || 0), 0);
    const prizePool = Math.max(300, paidTotal);
    const logs: any = await db.execute(sql`SELECT id,discord_id,contact_email,template_key,subject,mode,status,error,sent_at,admin_name FROM season_email_log WHERE season_key=${SEASON_OFFICIAL_KEY} ORDER BY id DESC LIMIT 80`);
    res.setHeader("Cache-Control", "no-store");
    return void res.json({ ok: true, emailMode: seasonEmailMode(), summary: { total: rows.length, active: active.length, pending: rows.filter((x:any)=>x.status==='pending').length, cancelled: rows.filter((x:any)=>x.status==='cancelled').length, paidTotal, prizePool, firstPrize: prizePool*.5, secondPrize: prizePool*.3 }, registrations: rows, emailLogs: logs?.rows || [], templates: Object.entries(templateLabels).map(([key,label])=>({key,label})) });
  } catch (error) {
    req.log?.error?.({ error }, "official season admin list failed");
    return void res.status(500).json({ error: "Falha ao carregar inscrições oficiais." });
  }
});

router.get("/official-registrations.csv", async (req, res) => {
  await ensureOfficialTable();
  const r: any = await db.execute(sql`SELECT discord_id,discord_name,steam_id,status,amount,full_name,contact_email,prize_pix_type,prize_pix_key,mp_payment_id,created_at,paid_at FROM season_official_registrations WHERE season_key=${SEASON_OFFICIAL_KEY} ORDER BY created_at ASC`);
  const headers = ["Discord ID","Discord","SteamID","Status","Valor","Nome completo","E-mail","Tipo PIX","Chave PIX","Pagamento","Criado em","Pago em"];
  const lines = [headers.map(csvCell).join(","), ...(r?.rows || []).map((x:any)=>[x.discord_id,x.discord_name,x.steam_id,x.status,x.amount,x.full_name,x.contact_email,x.prize_pix_type,x.prize_pix_key,x.mp_payment_id,x.created_at,x.paid_at].map(csvCell).join(","))];
  res.setHeader("Cache-Control","no-store"); res.setHeader("Content-Disposition","attachment; filename=season1-inscritos.csv");
  return void res.type("text/csv; charset=utf-8").send("\ufeff" + lines.join("\n"));
});

router.post("/email/preview", async (req, res) => {
  await ensureOfficialTable();
  const template = req.body?.template;
  if (!isTemplate(template)) return void res.status(400).json({ error: "Modelo de e-mail inválido." });
  const id = String(req.body?.discordId || "").trim();
  let row = id ? await getRow(id) : null;
  if (!row) {
    const sample: any = await db.execute(sql`SELECT discord_id,discord_name,steam_id,COALESCE(full_name,discord_name) full_name,contact_email FROM season_official_registrations WHERE season_key=${SEASON_OFFICIAL_KEY} ORDER BY paid_at ASC NULLS LAST LIMIT 1`);
    row = sample?.rows?.[0] || { discord_id:"000000000000000000",discord_name:"Jogador",steam_id:"76561190000000000",full_name:"Participante Guerra Fria",contact_email:"jogador@exemplo.com" };
  }
  const winners = template === "end" ? await getSeasonFinalWinners() : [];
  return void res.json({ ok:true, ...buildSeasonEmail(template,row,winners) });
});

router.post("/email/send", async (req, res) => {
  await ensureOfficialTable();
  const template = req.body?.template;
  if (!isTemplate(template)) return void res.status(400).json({ error: "Modelo de e-mail inválido." });
  const audience = String(req.body?.audience || "one");
  const force = Boolean(req.body?.force);
  const admin = adminName(req);
  if (audience === "all" && (template === "start" || template === "end")) {
    const result = await dispatchSeasonLifecycleEmail(template, admin, force);
    await db.execute(sql`INSERT INTO season_admin_actions(season_key,admin_name,action,details) VALUES(${SEASON_OFFICIAL_KEY},${admin},${`email_${template}_all`},${JSON.stringify(result).slice(0,1500)})`);
    return void res.json(result);
  }
  let rows: SeasonEmailRegistration[] = [];
  if (audience === "all") {
    const q: any = await db.execute(sql`SELECT discord_id,discord_name,steam_id,COALESCE(full_name,discord_name) full_name,contact_email FROM season_official_registrations WHERE season_key=${SEASON_OFFICIAL_KEY} AND status='active' AND contact_email IS NOT NULL AND TRIM(contact_email)<>'' ORDER BY paid_at ASC NULLS LAST`);
    rows = q?.rows || [];
  } else {
    const id = String(req.body?.discordId || "").trim();
    const row = id ? await getRow(id) : null;
    if (!row?.contact_email) return void res.status(404).json({ error: "Inscrito/e-mail não encontrado." });
    rows = [row];
  }
  const winners = template === "end" ? await getSeasonFinalWinners() : [];
  let sent=0,simulated=0,skipped=0,failed=0;
  for (const row of rows) {
    try { const r=await sendSeasonEmail({row,template,winners,adminName:admin,force}); if(r.status==='sent')sent++;else if(r.status==='simulated')simulated++;else skipped++; }
    catch { failed++; }
  }
  await db.execute(sql`INSERT INTO season_admin_actions(season_key,admin_name,action,discord_id,details) VALUES(${SEASON_OFFICIAL_KEY},${admin},${`email_${template}_${audience}`},${audience==='one'?rows[0]?.discord_id:null},${JSON.stringify({sent,simulated,skipped,failed,total:rows.length})})`);
  return void res.json({ok:failed===0,sent,simulated,skipped,failed,total:rows.length});
});

router.post("/registration-status", async (req, res) => {
  await ensureOfficialTable();
  const discordId = String(req.body?.discordId || "").trim();
  const status = String(req.body?.status || "").trim();
  const reason = String(req.body?.reason || "").trim().slice(0,500);
  if (!discordId || !["active","pending","cancelled"].includes(status)) return void res.status(400).json({error:"Dados inválidos."});
  if (reason.length < 3) return void res.status(400).json({error:"Informe o motivo administrativo."});
  const before: any = await db.execute(sql`SELECT status FROM season_official_registrations WHERE season_key=${SEASON_OFFICIAL_KEY} AND discord_id=${discordId} LIMIT 1`);
  if (!before?.rows?.[0]) return void res.status(404).json({error:"Inscrição não encontrada."});
  const admin = adminName(req);
  await db.transaction(async tx => {
    await tx.execute(sql`UPDATE season_official_registrations SET status=${status},updated_at=now() WHERE season_key=${SEASON_OFFICIAL_KEY} AND discord_id=${discordId}`);
    await tx.execute(sql`INSERT INTO season_admin_actions(season_key,admin_name,action,discord_id,details) VALUES(${SEASON_OFFICIAL_KEY},${admin},'registration_status',${discordId},${`status ${before.rows[0].status} -> ${status}; motivo: ${reason}`})`);
  });
  return void res.json({ok:true,discordId,status,admin,reason});
});

router.get("/actions", async (req,res)=>{
  await ensureOfficialTable();
  const r:any=await db.execute(sql`SELECT id,admin_name,action,discord_id,details,created_at FROM season_admin_actions WHERE season_key=${SEASON_OFFICIAL_KEY} ORDER BY id DESC LIMIT 100`);
  return void res.json({ok:true,actions:r?.rows||[]});
});

export default router;

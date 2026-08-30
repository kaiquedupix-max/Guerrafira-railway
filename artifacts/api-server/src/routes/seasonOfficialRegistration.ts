import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { getCommunitySession } from "../admin/communitySession.js";
import { getLinkedSteamV2 } from "../bot/utils/linkedSteamV2.js";
import { createPixPayment, createCardPreference } from "../bot/mp.js";
import { logger } from "../lib/logger.js";
import { sendSeasonRegistrationConfirmations } from "./seasonConfirmations.js";
import { rankIconData } from "./seasonRankIcons.js";

const router: IRouter = Router();
const PRICE = 20;
const OFFICIAL_KEY = 101;
const START = "04/09/2026 às 18:30";
const END = "30/09/2026 às 23:59";
const PIX_TYPES = new Set(["cpf", "email", "telefone", "aleatoria"]);
const PAYMENT_SIMULATION = String(process.env.SEASON_PAYMENT_SIMULATION ?? "true").toLowerCase() !== "false";
const SOLDADO = rankIconData("soldado");

type Profile = { fullName: string; contactEmail: string; pixType: string; pixKey: string };

async function ensureTables() {
  await db.execute(sql`CREATE TABLE IF NOT EXISTS season_official_registrations (
    season_key INTEGER NOT NULL,
    discord_id TEXT NOT NULL,
    discord_name TEXT NOT NULL,
    steam_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    amount NUMERIC(10,2) NOT NULL DEFAULT 20,
    mp_payment_id TEXT,
    mp_preference_id TEXT,
    full_name TEXT,
    contact_email TEXT,
    prize_pix_type TEXT,
    prize_pix_key TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    paid_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY(season_key,discord_id)
  )`);
  for (const c of [
    "full_name TEXT", "contact_email TEXT", "prize_pix_type TEXT", "prize_pix_key TEXT",
    "confirmation_email_sent_at TIMESTAMPTZ", "confirmation_email_status TEXT", "confirmation_last_error TEXT"
  ]) await db.execute(sql.raw(`ALTER TABLE season_official_registrations ADD COLUMN IF NOT EXISTS ${c}`));
}

function clean(v: unknown, max: number) { return String(v ?? "").trim().slice(0, max); }
function profileFrom(body: any): Profile | { error: string } {
  const fullName = clean(body?.fullName, 120);
  const contactEmail = clean(body?.contactEmail || body?.email, 160).toLowerCase();
  const pixType = clean(body?.pixType, 20).toLowerCase();
  const pixKey = clean(body?.pixKey, 180);
  if (fullName.length < 5 || !fullName.includes(" ")) return { error: "Informe seu nome completo." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(contactEmail)) return { error: "Informe um e-mail de contato válido." };
  if (!PIX_TYPES.has(pixType)) return { error: "Selecione o tipo da chave PIX para premiação." };
  if (!pixKey) return { error: "Informe a chave PIX que será usada caso você ganhe." };
  if (pixType === "cpf" && pixKey.replace(/\D/g, "").length !== 11) return { error: "A chave PIX CPF deve possuir 11 dígitos." };
  if (pixType === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(pixKey)) return { error: "Informe uma chave PIX do tipo e-mail válida." };
  if (pixType === "telefone") { const d = pixKey.replace(/\D/g, ""); if (d.length < 10 || d.length > 13) return { error: "Informe uma chave PIX telefone válida." }; }
  return { fullName, contactEmail, pixType, pixKey };
}

async function saveProfile(discordId: string, discordName: string, steamId: string, p: Profile) {
  await ensureTables();
  await db.execute(sql`INSERT INTO season_official_registrations(
    season_key,discord_id,discord_name,steam_id,status,amount,full_name,contact_email,prize_pix_type,prize_pix_key,updated_at
  ) VALUES(
    ${OFFICIAL_KEY},${discordId},${discordName},${steamId},'pending',${PRICE},${p.fullName},${p.contactEmail},${p.pixType},${p.pixKey},now()
  ) ON CONFLICT(season_key,discord_id) DO UPDATE SET
    discord_name=EXCLUDED.discord_name,steam_id=EXCLUDED.steam_id,full_name=EXCLUDED.full_name,
    contact_email=EXCLUDED.contact_email,prize_pix_type=EXCLUDED.prize_pix_type,prize_pix_key=EXCLUDED.prize_pix_key,updated_at=now()`);
}

async function mpPayment(id: string) {
  const token = String(process.env.MP_ACCESS_TOKEN || "");
  if (!token) return null;
  const r = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${token}` } });
  return r.ok ? await r.json() as any : null;
}
async function finishActivation(discordId: string, paymentId: string) {
  await ensureTables();
  await db.execute(sql`UPDATE season_official_registrations SET status='active',mp_payment_id=${paymentId},paid_at=COALESCE(paid_at,now()),updated_at=now() WHERE season_key=${OFFICIAL_KEY} AND discord_id=${discordId}`);
  const delivery = await sendSeasonRegistrationConfirmations(discordId);
  return { ok: true, delivery };
}
async function activateReal(discordId: string, paymentId: string) {
  const p = await mpPayment(paymentId);
  if (!p || String(p.status) !== "approved") return { ok: false };
  const metadata = p.metadata || {};
  if (String(metadata.discord_user_id || "") !== discordId || String(metadata.vip_tier || "") !== "season1_entry") return { ok: false };
  return finishActivation(discordId, paymentId);
}

router.get("/season/1/inscricao-oficial/status", async (req, res) => {
  const session = getCommunitySession(req); if (!session) return void res.status(401).json({ ok: false, authenticated: false });
  await ensureTables();
  const r: any = await db.execute(sql`SELECT status,amount,created_at,paid_at,confirmation_email_status,(full_name IS NOT NULL AND contact_email IS NOT NULL AND prize_pix_type IS NOT NULL AND prize_pix_key IS NOT NULL) profile_complete FROM season_official_registrations WHERE season_key=${OFFICIAL_KEY} AND discord_id=${session.userId} LIMIT 1`);
  return void res.json({ ok: true, paymentSimulation: PAYMENT_SIMULATION, registered: r?.rows?.[0]?.status === 'active', registration: r?.rows?.[0] || null });
});

router.post("/season/1/inscricao-oficial/dados", async (req, res) => {
  const session = getCommunitySession(req); if (!session) return void res.status(401).json({ error: "Entre com Discord para continuar." });
  const linked = await getLinkedSteamV2(session.userId); if (!linked?.steamId) return void res.status(409).json({ error: "Vincule sua Steam antes de concluir a inscrição." });
  const parsed = profileFrom(req.body); if ("error" in parsed) return void res.status(400).json({ error: parsed.error });
  await saveProfile(session.userId, session.username, linked.steamId, parsed); return void res.json({ ok: true });
});

router.post("/season/1/inscricao-oficial/simular-pagamento", async (req, res) => {
  if (!PAYMENT_SIMULATION) return void res.status(404).json({ error: "Simulação desativada." });
  const session = getCommunitySession(req); if (!session) return void res.status(401).json({ error: "Entre com Discord para continuar." });
  const linked = await getLinkedSteamV2(session.userId); if (!linked?.steamId) return void res.status(409).json({ error: "Vincule sua Steam antes de testar a inscrição." });
  const parsed = profileFrom(req.body); if ("error" in parsed) return void res.status(400).json({ error: parsed.error });
  await saveProfile(session.userId, session.username, linked.steamId, parsed);
  const id = `SIM-SEASON1-${Date.now()}-${session.userId}`;
  const result = await finishActivation(session.userId, id);
  return void res.json({ ...result, paymentId: id, simulated: true });
});

router.post("/season/1/inscricao-oficial/resetar-teste", async (req, res) => {
  if (!PAYMENT_SIMULATION) return void res.status(404).json({ error: "Reset de teste indisponível." });
  const session = getCommunitySession(req); if (!session) return void res.status(401).json({ error: "Sessão inválida." });
  await ensureTables();
  await db.execute(sql`DELETE FROM season_official_registrations WHERE season_key=${OFFICIAL_KEY} AND discord_id=${session.userId}`);
  return void res.json({ ok: true, message: "Inscrição de teste apagada. Você já pode refazer o fluxo." });
});

router.post("/season/1/inscricao-oficial/pix", async (req, res) => {
  if (PAYMENT_SIMULATION) return void res.status(409).json({ error: "Pagamento real está desativado. Use a simulação." });
  const session = getCommunitySession(req); if (!session) return void res.status(401).json({ error: "Entre com Discord para se inscrever." });
  const linked = await getLinkedSteamV2(session.userId); if (!linked?.steamId) return void res.status(409).json({ error: "Vincule sua Steam antes de pagar a inscrição." });
  const parsed = profileFrom(req.body); if ("error" in parsed) return void res.status(400).json({ error: parsed.error });
  await saveProfile(session.userId, session.username, linked.steamId, parsed);
  const payment = await createPixPayment({ amount: PRICE, description: "Inscrição Season 1 Guerra Fria", email: parsed.contactEmail, discordUserId: session.userId, steamId: linked.steamId, vipTier: "season1_entry" });
  if ("error" in payment) return void res.status(502).json({ error: payment.error });
  await db.execute(sql`UPDATE season_official_registrations SET status='pending',amount=${PRICE},mp_payment_id=${payment.paymentId},updated_at=now() WHERE season_key=${OFFICIAL_KEY} AND discord_id=${session.userId}`);
  return void res.json({ ok: true, paymentId: payment.paymentId, qrCode: payment.qrCode, qrCodeBase64: payment.qrCodeBase64, expiresAt: payment.expiresAt });
});

router.post("/season/1/inscricao-oficial/card", async (req, res) => {
  if (PAYMENT_SIMULATION) return void res.status(409).json({ error: "Pagamento real está desativado. Use a simulação." });
  const session = getCommunitySession(req); if (!session) return void res.status(401).json({ error: "Entre com Discord para se inscrever." });
  const linked = await getLinkedSteamV2(session.userId); if (!linked?.steamId) return void res.status(409).json({ error: "Vincule sua Steam antes de pagar a inscrição." });
  const parsed = profileFrom(req.body); if ("error" in parsed) return void res.status(400).json({ error: parsed.error });
  await saveProfile(session.userId, session.username, linked.steamId, parsed);
  const preference = await createCardPreference({ amount: PRICE, title: "Inscrição Season 1 Guerra Fria", discordUserId: session.userId, steamId: linked.steamId, vipTier: "season1_entry" });
  if (!preference) return void res.status(502).json({ error: "Não foi possível abrir o checkout." });
  await db.execute(sql`UPDATE season_official_registrations SET status='pending',amount=${PRICE},mp_preference_id=${preference.preferenceId},updated_at=now() WHERE season_key=${OFFICIAL_KEY} AND discord_id=${session.userId}`);
  return void res.json({ ok: true, checkoutUrl: preference.checkoutUrl });
});

router.post("/season/1/inscricao-oficial/confirmar", async (req, res) => {
  const session = getCommunitySession(req); if (!session) return void res.status(401).json({ ok: false });
  const id = String(req.body?.paymentId || ""); if (!id) return void res.status(400).json({ ok: false });
  try { return void res.json(await activateReal(session.userId, id)); }
  catch (error) { logger.error({ error }, "season official payment confirmation failed"); return void res.status(500).json({ ok: false }); }
});

router.get("/season/1/inscricao-oficial", async (req, res) => {
  const session = getCommunitySession(req); if (!session) return void res.redirect("/api/admin/auth/login?target=season");
  await ensureTables();
  const r: any = await db.execute(sql`SELECT status,steam_id,full_name,contact_email,prize_pix_type,prize_pix_key,confirmation_email_status FROM season_official_registrations WHERE season_key=${OFFICIAL_KEY} AND discord_id=${session.userId} LIMIT 1`);
  const row = r?.rows?.[0] || null;
  const active = row?.status === 'active';
  const profileComplete = Boolean(row?.full_name && row?.contact_email && row?.prize_pix_type && row?.prize_pix_key);
  const esc = (v: any) => String(v || '').replace(/["&<>]/g, '');
  const safe = esc(session.username), steamId = esc(row?.steam_id || '');
  res.setHeader("Cache-Control", "no-store");

  if (active && profileComplete) {
    return void res.type("html").send(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#080a0d"><title>Meu perfil • Season 1</title><style>
*{box-sizing:border-box}body{margin:0;background:#080a0d;color:#f8fafc;font-family:Inter,system-ui,-apple-system,sans-serif;min-height:100vh}.w{width:min(920px,calc(100% - 24px));margin:auto;padding:20px 0 90px}.back{color:#aab2bd;text-decoration:none;font-size:11px;font-weight:850}.hero{margin-top:18px;border:1px solid #25613f;border-radius:25px;padding:27px;background:radial-gradient(circle at 90% 0,#22c55e20,transparent 34%),linear-gradient(145deg,#0d2118,#0d1116 66%)}.tag{display:inline-flex;border:1px solid #22c55e55;background:#22c55e12;color:#86efac;border-radius:999px;padding:7px 10px;font-size:9px;font-weight:1000;letter-spacing:.12em}.hero h1{font-size:clamp(35px,8vw,60px);line-height:.96;letter-spacing:-.05em;margin:13px 0 7px}.hero p{color:#aab2bd;line-height:1.6;font-size:12px}.profile{margin-top:14px;border:1px solid #2d333c;background:linear-gradient(180deg,#11161c,#0b0f13);border-radius:22px;padding:22px}.top{display:grid;grid-template-columns:120px 1fr;gap:18px;align-items:center}.rankImg{width:110px;height:126px;object-fit:contain;filter:drop-shadow(0 12px 18px #000b)}.label{font-size:9px;color:#7f8895;letter-spacing:.12em;font-weight:900}.rankName{font-size:28px;font-weight:1000;margin:4px 0}.xp{font-size:17px;color:#fbbf24;font-weight:950}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:9px;margin:18px 0}.stat{border:1px solid #303741;background:#0c1116;border-radius:14px;padding:13px}.stat small{display:block;color:#777f8a;font-size:8px;letter-spacing:.09em}.stat b{display:block;margin-top:5px;font-size:16px}.barWrap{margin-top:16px}.barHead{display:flex;justify-content:space-between;gap:10px;align-items:end;margin-bottom:8px}.barHead b{font-size:12px}.barHead span{color:#9aa2ad;font-size:10px}.bar{height:14px;background:#222831;border-radius:99px;overflow:hidden}.fill{height:100%;width:0;background:linear-gradient(90deg,#ef4444,#f59e0b,#fbbf24);transition:width .5s ease}.progressText{color:#a7afb9;font-size:11px;line-height:1.55;margin-top:9px}.infoGrid{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:14px}.info{border:1px solid #2d333c;background:#0c1015;border-radius:14px;padding:13px}.info small{display:block;color:#777f89;font-size:8px}.info b{display:block;margin-top:5px;font-size:11px}.actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px}.btn{display:inline-flex;justify-content:center;text-decoration:none;border:1px solid #3a414b;background:#15191f;color:#fff;border-radius:11px;padding:12px 14px;font-size:10px;font-weight:950;cursor:pointer}.danger{border-color:#7f1d1d;background:#2b1012;color:#fecaca}.note{margin-top:12px;color:#78818d;font-size:10px;line-height:1.5}.msg{margin-top:8px;color:#fca5a5;font-size:10px}
@media(max-width:620px){.top{grid-template-columns:90px 1fr}.rankImg{width:84px;height:98px}.rankName{font-size:22px}.stats{grid-template-columns:1fr 1fr}.infoGrid{grid-template-columns:1fr}.actions .btn{width:100%}}
</style></head><body><main class="w"><a class="back" href="/season1">← Voltar para a Season</a><section class="hero"><span class="tag">✓ INSCRIÇÃO CONFIRMADA • SEASON 1</span><h1>Meu perfil da Season</h1><p>Olá, <b>${safe}</b>. Sua vaga está confirmada. Este painel já começa em zero e passa a atualizar automaticamente assim que suas ações forem registradas.</p></section><section class="profile"><div class="top"><img class="rankImg" id="rankImg" src="${SOLDADO}" alt="Patente"><div><div class="label">PATENTE ATUAL</div><div class="rankName" id="rankName">Soldado</div><div class="xp" id="xp">0 XP</div><div class="label" id="position">POSIÇÃO #0 • AGUARDANDO ATIVIDADE</div></div></div><div class="stats"><div class="stat"><small>POSIÇÃO</small><b id="sPos">#0</b></div><div class="stat"><small>XP</small><b id="sXp">0</b></div><div class="stat"><small>KILLS</small><b id="sKills">0</b></div><div class="stat"><small>DEATHS</small><b id="sDeaths">0</b></div><div class="stat"><small>HEADSHOTS</small><b id="sHs">0</b></div><div class="stat"><small>ASSISTÊNCIAS</small><b id="sAssists">0</b></div><div class="stat"><small>RAIDS</small><b id="sRaids">0</b></div><div class="stat"><small>DEFESAS</small><b id="sDef">0</b></div><div class="stat"><small>BRADLEY</small><b id="sBradley">0</b></div><div class="stat"><small>HELICÓPTERO</small><b id="sHeli">0</b></div><div class="stat"><small>CRATES</small><b id="sCrates">0</b></div><div class="stat"><small>STEAM</small><b style="font-size:10px">${steamId}</b></div></div><div class="barWrap"><div class="barHead"><b>Progresso para a próxima patente</b><span id="next">Tenente • 600 XP</span></div><div class="bar"><div class="fill" id="fill"></div></div><div class="progressText" id="progress">0% concluído • faltam 600 XP para Tenente.</div></div><div class="infoGrid"><div class="info"><small>E-MAIL DE CONFIRMAÇÃO</small><b>${esc(row?.confirmation_email_status || 'aguardando')}</b></div><div class="info"><small>SEASON OFICIAL</small><b>${START} → ${END}</b></div></div><div class="actions"><a class="btn" href="/season1#ranking">VER RANKING COMPLETO</a><a class="btn" href="/season1/guia">COMO GANHAR XP</a>${PAYMENT_SIMULATION?'<button class="btn danger" id="reset">APAGAR INSCRIÇÃO DE TESTE E RECOMEÇAR</button>':''}</div>${PAYMENT_SIMULATION?'<div class="note">🧪 O reset apaga somente sua inscrição oficial de teste e os dados usados no checkout. Seu histórico de atividade do servidor não é apagado.</div><div class="msg" id="resetMsg"></div>':''}</section></main><script>
const n=v=>Number(v||0),f=v=>n(v).toLocaleString('pt-BR');
function set(id,v){const x=document.getElementById(id);if(x)x.textContent=String(v)}
(async()=>{try{const r=await fetch('/api/season/1/player/${steamId}?_='+Date.now(),{cache:'no-store'});const d=await r.json();const p=d.player;if(!p)return;document.getElementById('rankImg').src=p.patente_imagem||'${SOLDADO}';set('rankName',p.patente||'Soldado');set('xp',f(p.xp)+' XP');set('position','POSIÇÃO #'+f(p.position));set('sPos','#'+f(p.position));set('sXp',f(p.xp));set('sKills',f(p.kills));set('sDeaths',f(p.deaths));set('sHs',f(p.headshots));set('sAssists',f(p.assists));set('sRaids',f(p.raids_participated));set('sDef',f(p.raids_defended));set('sBradley',f(p.bradley_participations));set('sHeli',f(p.heli_participations));set('sCrates',f(p.crates_hacked));const pct=Math.max(0,Math.min(100,n(p.progresso_percentual)));document.getElementById('fill').style.width=pct+'%';if(p.proxima_patente){set('next',p.proxima_patente+' • '+f(p.xp_proxima_patente)+' XP');set('progress',pct+'% concluído • faltam '+f(p.xp_faltante)+' XP para '+p.proxima_patente+'.')}else{set('next',p.general_frio?'General Frio':'Top 1');set('progress',p.general_frio?'Você é o General Frio atual.':'Marechal alcançado. Agora dispute o Top 1 para conquistar General Frio.')}}catch(e){console.error(e)}})();
${PAYMENT_SIMULATION?`document.getElementById('reset').onclick=async function(){if(!confirm('Apagar sua inscrição de teste e voltar ao início do checkout?'))return;this.disabled=true;const m=document.getElementById('resetMsg');m.textContent='Apagando inscrição de teste...';try{const r=await fetch('/api/season/1/inscricao-oficial/resetar-teste',{method:'POST'});const d=await r.json();if(!r.ok)throw new Error(d.error||'Falha ao resetar');m.style.color='#86efac';m.textContent='Inscrição apagada. Reabrindo checkout...';setTimeout(()=>location.reload(),700)}catch(e){m.textContent=e.message;this.disabled=false}};`:''}
</script></body></html>`);
  }

  return void res.type("html").send(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#090b0e"><title>Inscrição Season 1 • Guerra Fria</title><style>
*{box-sizing:border-box}body{margin:0;background:#080a0d;color:#f8fafc;font-family:Inter,system-ui,-apple-system,sans-serif;min-height:100vh}.w{width:min(980px,calc(100% - 24px));margin:auto;padding:18px 0 80px}.back{color:#aab2bd;text-decoration:none;font-size:11px;font-weight:850}.hero{margin-top:16px;border:1px solid #4a2628;border-radius:26px;padding:30px;background:radial-gradient(circle at 90% 0,#ef444438,transparent 34%),linear-gradient(145deg,#251012,#101319 64%)}.tag{display:inline-flex;border:1px solid #ef44445c;background:#ef444414;color:#fecaca;border-radius:999px;padding:7px 10px;font-size:9px;font-weight:1000;letter-spacing:.13em}.heroGrid{display:grid;grid-template-columns:1fr 220px;gap:24px;align-items:center}.hero h1{font-size:clamp(38px,8vw,67px);line-height:.93;letter-spacing:-.055em;margin:12px 0}.hero p{color:#b8bec8;line-height:1.6;font-size:13px}.priceBox{border:1px solid #77402f;background:linear-gradient(155deg,#26170e,#121014);border-radius:20px;padding:19px;text-align:center}.priceBox strong{display:block;font-size:43px;color:#fbbf24;margin:6px 0}.layout{display:grid;grid-template-columns:1.35fr .65fr;gap:12px;align-items:start;margin-top:14px}.card{border:1px solid #2d333c;background:linear-gradient(180deg,#10141a,#0c0f13);border-radius:19px;padding:20px;margin-bottom:12px}.card h2{margin:0 0 5px;font-size:20px}.card p{color:#9fa7b2;line-height:1.55;font-size:11px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:11px}.lab{display:block;font-size:9px;color:#c5cbd4;font-weight:900;letter-spacing:.06em;margin-bottom:6px}.field{width:100%;padding:13px 12px;border-radius:11px;border:1px solid #343b45;background:#090c10;color:white;font-size:16px}.full{grid-column:1/-1}.summaryRow{display:flex;justify-content:space-between;gap:10px;padding:11px 0;border-top:1px solid #ffffff0d;font-size:11px}.summaryRow span{color:#8e96a1}.summaryRow.total strong{font-size:20px;color:#fbbf24}.btn{width:100%;border:1px solid #ef4444;border-radius:12px;padding:15px;font-weight:1000;cursor:pointer;background:linear-gradient(135deg,#ef4444,#b91c1c);color:white}.test{border-color:#775317;background:#211405}.test b{color:#fde68a}.privacy{color:#808894!important}.warn{color:#fca5a5;font-size:11px;min-height:18px;margin-top:9px;text-align:center}.prize{border-color:#72531c;background:radial-gradient(circle at 90% 0,#f59e0b22,transparent 40%),#111318}.prize h2{color:#fde68a}.prizeGrid{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-top:12px}.p{border:1px solid #4b3928;background:#151109;border-radius:11px;padding:10px;text-align:center}.p b{display:block;color:#fbbf24}.p small{color:#a9a29a;font-size:8px}
@media(max-width:760px){.hero{padding:22px 18px}.heroGrid,.layout{grid-template-columns:1fr}.priceBox{text-align:left}.grid{grid-template-columns:1fr}.full{grid-column:auto}.prizeGrid{grid-template-columns:1fr}}
</style></head><body><main class="w"><a class="back" href="/season1">← Voltar para a Season</a><section class="hero"><div class="heroGrid"><div><span class="tag">🏆 INSCRIÇÕES OFICIAIS ABERTAS</span><h1>Guerra Fria<br>Season 1</h1><p>Garanta sua vaga na temporada premiada. Sua conta Discord e sua Steam vinculada identificam sua participação.</p><p><b>${START}</b> → <b>${END}</b></p></div><div class="priceBox"><small>INSCRIÇÃO ÚNICA</small><strong>R$ 20</strong><span>Season 1 oficial</span></div></div></section>${PAYMENT_SIMULATION?'<section class="card test"><b>🧪 Ambiente de teste ativo</b><p>Nenhuma cobrança real será realizada. A aprovação é simulada para você testar o fluxo completo; o e-mail de confirmação, porém, já é enviado pelo sistema real.</p></section>':''}<section class="card prize"><h2>🏆 Premiação oficial</h2><p>A Season começa com <b>R$ 300 de premiação mínima garantida</b> e o valor pode crescer com as inscrições pagas.</p><div class="prizeGrid"><div class="p"><b>🥇 50%</b><small>do valor acumulado</small></div><div class="p"><b>🥈 30%</b><small>do valor acumulado</small></div><div class="p"><b>🥉 VIP Ouro</b><small>por 30 dias</small></div></div></section><div class="layout"><section class="card"><h2>Dados do participante</h2><p>Preencha seus dados reais. O e-mail será usado para confirmação e a chave PIX somente para eventual premiação.</p><div class="grid"><div><label class="lab">NOME COMPLETO</label><input class="field" id="fullName" autocomplete="name" value="${esc(row?.full_name)}" placeholder="Nome e sobrenome"></div><div><label class="lab">E-MAIL DE CONTATO</label><input class="field" id="contactEmail" type="email" autocomplete="email" value="${esc(row?.contact_email)}" placeholder="voce@email.com"></div><div><label class="lab">TIPO DA CHAVE PIX</label><select class="field" id="pixType"><option value="">Selecione</option><option value="cpf">CPF</option><option value="email">E-mail</option><option value="telefone">Telefone</option><option value="aleatoria">Chave aleatória</option></select></div><div><label class="lab">CHAVE PIX PARA PRÊMIO</label><input class="field" id="pixKey" value="${esc(row?.prize_pix_key)}" placeholder="Sua chave PIX"></div></div><p class="privacy">🔒 Seus dados pessoais e sua chave PIX são privados.</p></section><aside><section class="card"><h2>Resumo</h2><div class="summaryRow"><span>Produto</span><strong>Season 1</strong></div><div class="summaryRow"><span>Período</span><strong>04/09 → 30/09</strong></div><div class="summaryRow"><span>Confirmação</span><strong>E-mail</strong></div><div class="summaryRow total"><span>Total</span><strong>R$ 20,00</strong></div><button class="btn" id="pay">${PAYMENT_SIMULATION?'SIMULAR APROVAÇÃO • R$ 20':'CONTINUAR PARA PAGAMENTO'}</button><div id="out" class="warn"></div></section></aside></div></main><script>
const out=document.getElementById('out'),btn=document.getElementById('pay');const saved=${JSON.stringify(String(row?.prize_pix_type||''))};if(saved)document.getElementById('pixType').value=saved;function payload(){return{fullName:document.getElementById('fullName').value,contactEmail:document.getElementById('contactEmail').value,pixType:document.getElementById('pixType').value,pixKey:document.getElementById('pixKey').value}}async function post(url,body){const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body||{})});const d=await r.json();if(!r.ok)throw new Error(d.error||'Não foi possível continuar.');return d}btn.onclick=async()=>{btn.disabled=true;try{out.style.color='#fbbf24';out.textContent='Validando dados...';${PAYMENT_SIMULATION?`const d=await post('/api/season/1/inscricao-oficial/simular-pagamento',payload());out.style.color=d.delivery&&d.delivery.email==='sent'?'#86efac':'#fbbf24';out.textContent=d.delivery&&d.delivery.email==='sent'?'✓ Inscrição aprovada e e-mail enviado.':'✓ Inscrição aprovada. Verifique o status do e-mail no perfil.';setTimeout(()=>location.reload(),1000);`:`out.textContent='Pagamento real será aberto nesta etapa quando o modo de teste for desligado.'`}}catch(e){out.style.color='#fca5a5';out.textContent=e.message;btn.disabled=false}}
</script></body></html>`);
});

export default router;

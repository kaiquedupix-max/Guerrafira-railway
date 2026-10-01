import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { getCommunitySession } from "../admin/communitySession.js";
import { getLinkedSteamV2, saveLinkedSteamV2 } from "../bot/utils/linkedSteamV2.js";
import { createCardPreference, createPixPayment } from "../bot/mp.js";
import { logger } from "../lib/logger.js";
import {
  SEASON_2_END,
  SEASON_2_PRIZE,
  SEASON_2_REGISTRATION_DEADLINE,
  SEASON_2_START,
  seasonRegistrationKey,
} from "./seasonRanks.js";

const router: IRouter = Router();
const SEASON = 2;
const KEY = seasonRegistrationKey(SEASON);
const PRICE = 20;
const PAYMENT_TIER = "season2_entry";
const BASE_URL = "https://www.guerrafriarust.com.br";
const STEAM_OPENID = "https://steamcommunity.com/openid/login";
const REGISTRATION_PATH = "/api/season/2/inscricao-oficial";
const STEAM_LOGIN_PATH = "/api/season/2/steam-oficial/login";
const STEAM_CALLBACK_URL = `${BASE_URL}/api/season/2/steam-oficial/callback`;
const DEADLINE = new Date("2026-10-20T23:59:59-03:00");
const PIX_TYPES = new Set(["cpf","email","telefone","aleatoria"]);

const esc=(value:unknown)=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]||c));
const clean=(value:unknown,max=180)=>String(value??"").trim().slice(0,max);

function registrationOpen(){return Date.now()<=DEADLINE.getTime();}

async function ensureTable(){
  await db.execute(sql`CREATE TABLE IF NOT EXISTS season_official_registrations (
    season_key INTEGER NOT NULL,
    discord_id TEXT NOT NULL,
    discord_name TEXT NOT NULL,
    steam_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    amount NUMERIC(10,2) NOT NULL DEFAULT 0,
    mp_payment_id TEXT,
    mp_preference_id TEXT,
    full_name TEXT,
    contact_email TEXT,
    prize_pix_type TEXT,
    prize_pix_key TEXT,
    entry_type TEXT,
    accepted_terms_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    paid_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY(season_key,discord_id)
  )`);
  for(const column of [
    "full_name TEXT","contact_email TEXT","prize_pix_type TEXT","prize_pix_key TEXT",
    "entry_type TEXT","accepted_terms_at TIMESTAMPTZ"
  ]) await db.execute(sql.raw(`ALTER TABLE season_official_registrations ADD COLUMN IF NOT EXISTS ${column}`));
}

function validate(body:any){
  const fullName=clean(body?.fullName,120);
  const contactEmail=clean(body?.contactEmail,180).toLowerCase();
  const pixType=clean(body?.pixType,20).toLowerCase();
  const pixKey=clean(body?.pixKey,180);
  if(fullName.split(/\s+/).length<2)return{error:"Informe seu nome completo."};
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(contactEmail))return{error:"Informe um e-mail válido."};
  if(!PIX_TYPES.has(pixType))return{error:"Selecione o tipo da chave PIX para eventual premiação."};
  if(!pixKey)return{error:"Informe a chave PIX para eventual premiação."};
  if(pixType==="cpf"&&pixKey.replace(/\D/g,"").length!==11)return{error:"A chave PIX CPF deve possuir 11 dígitos."};
  if(pixType==="email"&&!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(pixKey))return{error:"Informe uma chave PIX do tipo e-mail válida."};
  if(pixType==="telefone"){const d=pixKey.replace(/\D/g,"");if(d.length<10||d.length>13)return{error:"Informe uma chave PIX telefone válida."};}
  if(body?.accept!==true)return{error:"Aceite o regulamento da Season 2 para continuar."};
  return{fullName,contactEmail,pixType,pixKey};
}

async function savePending(discordId:string,discordName:string,steamId:string,profile:ReturnType<typeof validate>){
  if("error" in profile)throw new Error(profile.error);
  const duplicate:any=await db.execute(sql`SELECT discord_id FROM season_official_registrations WHERE season_key=${KEY} AND steam_id=${steamId} AND status='active' AND discord_id<>${discordId} LIMIT 1`);
  if(duplicate?.rows?.[0])throw new Error("Esta Steam já está inscrita na Season 2 por outra conta Discord.");
  await db.execute(sql`INSERT INTO season_official_registrations(
    season_key,discord_id,discord_name,steam_id,status,amount,full_name,contact_email,prize_pix_type,prize_pix_key,entry_type,accepted_terms_at,updated_at
  ) VALUES(
    ${KEY},${discordId},${discordName},${steamId},'pending',${PRICE},${profile.fullName},${profile.contactEmail},${profile.pixType},${profile.pixKey},'paid',now(),now()
  ) ON CONFLICT(season_key,discord_id) DO UPDATE SET
    discord_name=EXCLUDED.discord_name,steam_id=EXCLUDED.steam_id,status=CASE WHEN season_official_registrations.status='active' THEN 'active' ELSE 'pending' END,
    amount=${PRICE},full_name=EXCLUDED.full_name,contact_email=EXCLUDED.contact_email,prize_pix_type=EXCLUDED.prize_pix_type,
    prize_pix_key=EXCLUDED.prize_pix_key,entry_type='paid',accepted_terms_at=now(),updated_at=now()`);
}

async function fetchMpPayment(paymentId:string){
  const token=String(process.env.MP_ACCESS_TOKEN||"").trim();
  if(!token)return null;
  const response=await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`,{headers:{Authorization:`Bearer ${token}`}});
  return response.ok?await response.json() as any:null;
}

export async function processSeason2Payment(payment:Record<string,any>):Promise<boolean>{
  const metadata=(payment?.metadata??{}) as Record<string,unknown>;
  if(String(metadata.vip_tier??"")!==PAYMENT_TIER)return false;
  const discordId=String(metadata.discord_user_id??"");
  const paymentId=String(payment.id??"");
  if(!discordId||!paymentId)return true;
  const amount=Number(payment.transaction_amount??0);
  if(String(payment.status)==="approved"&&amount>=19.99&&amount<=20.01){
    await ensureTable();
    await db.execute(sql`UPDATE season_official_registrations SET status='active',entry_type='paid',amount=${PRICE},mp_payment_id=${paymentId},paid_at=COALESCE(paid_at,now()),updated_at=now() WHERE season_key=${KEY} AND discord_id=${discordId}`);
    logger.info({discordId,paymentId},"Season 2 paid registration activated");
  }
  return true;
}

function style(){
  return `<style>
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:radial-gradient(circle at 50% -10%,#143923,#0b1510 30%,#07090c 68%);color:#f8fafc;font-family:Inter,system-ui,-apple-system,sans-serif;min-height:100vh}.w{width:min(1020px,calc(100% - 24px));margin:auto;padding:25px 0 90px}.back{display:inline-flex;color:#aeb8b1;text-decoration:none;border:1px solid #2b3830;background:#0b120e;border-radius:11px;padding:10px 13px;font-size:10px;font-weight:900}.hero{margin-top:18px;border:1px solid #326044;border-radius:26px;padding:30px;background:radial-gradient(circle at 88% 0,#22c55e27,transparent 34%),linear-gradient(145deg,#10291b,#0b1010 67%);box-shadow:0 25px 70px #0008}.tag{display:inline-flex;border:1px solid #22c55e66;background:#22c55e12;color:#86efac;border-radius:999px;padding:7px 10px;font-size:9px;font-weight:1000;letter-spacing:.13em}.hero h1{font-size:clamp(38px,8vw,68px);line-height:.94;letter-spacing:-.055em;margin:12px 0 9px}.hero p{max-width:800px;color:#b6c0b9;line-height:1.65;font-size:12px}.facts{display:grid;grid-template-columns:repeat(4,1fr);gap:9px;margin:13px 0}.fact,.card{border:1px solid #2a342e;background:#0d1310;border-radius:17px;padding:15px}.fact small{display:block;color:#748078;font-size:8px;letter-spacing:.1em;font-weight:900}.fact b{display:block;margin-top:5px;font-size:14px}.prize{border-color:#80611f;background:radial-gradient(circle at 90% 0,#fbbf2423,transparent 38%),#151208}.prize strong{color:#fbbf24}.prizeGrid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:13px}.award{border:1px solid #59451f;background:#151109;border-radius:13px;padding:13px;text-align:center}.award span{font-size:24px}.award b{display:block;color:#fde68a;margin-top:4px}.award small{color:#9c9588;font-size:9px}.card{margin-top:12px}.card h2{margin:0 0 6px;font-size:22px}.card p{color:#9da8a0;font-size:11px;line-height:1.65}.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.field label{display:block;color:#a9b2ac;font-size:9px;font-weight:900;margin:0 0 6px}.field input,.field select{width:100%;height:47px;border:1px solid #344139;border-radius:11px;background:#080d0a;color:#fff;padding:0 12px}.check{display:flex;gap:9px;align-items:flex-start;color:#c8d0cb;font-size:11px;line-height:1.55;margin:15px 0}.btn{width:100%;border:1px solid #22c55e;border-radius:12px;padding:14px;background:linear-gradient(135deg,#16a34a,#166534);color:#fff;font-weight:1000;cursor:pointer;text-decoration:none;display:flex;align-items:center;justify-content:center}.steam{background:linear-gradient(135deg,#1b2838,#2a475e);border-color:#66c0f4}.msg{margin-top:10px;color:#fca5a5;font-size:11px}.ok{border-color:#2e7048;background:linear-gradient(145deg,#10271a,#0b1110)}.profile{display:grid;grid-template-columns:1fr auto;gap:14px;align-items:center}.profile strong{font-size:28px}.pill{display:inline-flex;border:1px solid #386c4a;border-radius:999px;padding:6px 9px;color:#86efac;font-size:8px;font-weight:1000}.actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:13px}.actions a{width:auto;min-width:180px}.notice{border:1px solid #5b4930;background:#18130b;border-radius:14px;padding:13px;color:#e8d6b2;font-size:11px;line-height:1.6;margin-top:12px}@media(max-width:720px){.facts,.grid,.prizeGrid{grid-template-columns:1fr}.profile{grid-template-columns:1fr}.actions a{width:100%}.hero{padding:22px 18px}}
</style>`;
}

function shell(body:string,title="Inscrição Season 2"){
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#07100a"><title>${title} • Guerra Fria</title>${style()}</head><body><main class="w">${body}</main></body></html>`;
}

function steamGate(username:string){
  return shell(`<a class="back" href="/season2">← VOLTAR PARA A SEASON 2</a><section class="hero"><span class="tag">🏆 SEASON 2 • INSCRIÇÕES JÁ ABERTAS</span><h1>Confirme sua Steam.</h1><p>Seu Discord <b>${esc(username)}</b> já está conectado. Agora confirme a Steam oficial que vai disputar a Season 2. A senha é informada somente no site da Steam e nunca passa pelo Guerra Fria.</p></section><div class="facts"><div class="fact"><small>INSCRIÇÃO</small><b>R$ 20</b></div><div class="fact"><small>PREMIAÇÃO</small><b>R$ 500 garantidos</b></div><div class="fact"><small>PATENTES</small><b>15 níveis</b></div><div class="fact"><small>INÍCIO</small><b>09/10 • 18:30</b></div></div><section class="card"><h2>Steam ainda não vinculada</h2><p>Use o login oficial abaixo para vincular uma Steam ao seu Discord. Depois você volta automaticamente para concluir a inscrição e o pagamento.</p><a class="btn steam" href="${STEAM_LOGIN_PATH}">ENTRAR COM STEAM</a></section>`);
}

function rulesPage(){
 return shell(`<a class="back" href="/season2">← VOLTAR PARA A SEASON 2</a><section class="hero"><span class="tag">📜 REGULAMENTO • SEASON 2</span><h1>Competição limpa e premiada.</h1><p>Regras essenciais da segunda temporada competitiva do Guerra Fria.</p></section>
 <section class="card"><h2>1. Período e inscrição</h2><p>A Season 2 ocorre de <b>${SEASON_2_START}</b> até <b>${SEASON_2_END}</b>. A inscrição custa <b>R$ 20</b> e fica aberta até <b>${SEASON_2_REGISTRATION_DEADLINE}</b>. É obrigatório vincular Discord e Steam. A vaga só é confirmada após aprovação do pagamento.</p></section>
 <section class="card prize"><h2>2. Premiação garantida de <strong>R$ 500</strong></h2><div class="prizeGrid"><div class="award"><span>🥇</span><b>R$ 250</b><small>50% • 1º lugar</small></div><div class="award"><span>🥈</span><b>R$ 150</b><small>30% • 2º lugar</small></div><div class="award"><span>🥉</span><b>VIP Ouro</b><small>3º lugar</small></div></div><p>O 1º lugar recebe 50% de R$ 500, o 2º recebe 30% e o 3º recebe um VIP Ouro. A premiação é garantida pelo servidor e não depende do volume de doações.</p></section>
 <section class="card"><h2>3. Ranking, XP e patentes</h2><p>Todos os inscritos disputam o mesmo ranking. A Season 2 possui 15 patentes. XP é obtido somente por ações válidas registradas pelo sistema. Ajustes administrativos podem ocorrer para corrigir abuso, erro técnico ou exploração.</p></section>
 <section class="card"><h2>4. Integridade competitiva</h2><p>Cheat, automação proibida, exploração deliberada de falhas, manipulação artificial de pontuação, farm combinado ou tentativa de burlar o sistema pode resultar em retirada de XP, desclassificação e medidas administrativas previstas nas regras do servidor.</p></section>
 <section class="card"><h2>5. Doações</h2><p>Doações ao Guerra Fria são opcionais, ajudam na infraestrutura e não concedem XP, patente, posição, imunidade administrativa ou qualquer vantagem na Season 2.</p></section>`,"Regulamento Season 2");
}

router.get("/season/2/inscricao-oficial/status",async(req,res)=>{
  const session=getCommunitySession(req);if(!session)return void res.status(401).json({ok:false,authenticated:false});
  try{await ensureTable();const r:any=await db.execute(sql`SELECT status,entry_type,amount,steam_id,created_at FROM season_official_registrations WHERE season_key=${KEY} AND discord_id=${session.userId} LIMIT 1`);return void res.json({ok:true,registrationOpen:registrationOpen(),registered:r?.rows?.[0]?.status==="active",registration:r?.rows?.[0]||null});}
  catch(error){logger.error({error},"season2 status failed");return void res.status(500).json({error:"Falha ao consultar inscrição."});}
});

router.post("/season/2/inscricao-oficial/pix",async(req,res)=>{
  const session=getCommunitySession(req);if(!session)return void res.status(401).json({error:"Entre com Discord para continuar."});
  if(!registrationOpen())return void res.status(410).json({error:"As inscrições da Season 2 foram encerradas."});
  try{
    await ensureTable();
    const linked=await getLinkedSteamV2(session.userId);if(!linked?.steamId)return void res.status(409).json({error:"Vincule sua Steam antes de confirmar a inscrição."});
    const parsed=validate(req.body);if("error"in parsed)return void res.status(400).json({error:parsed.error});
    await savePending(session.userId,session.username,linked.steamId,parsed);
    const payment=await createPixPayment({amount:PRICE,description:"Inscrição Season 2 Guerra Fria",email:parsed.contactEmail,discordUserId:session.userId,steamId:linked.steamId,vipTier:PAYMENT_TIER});
    if("error"in payment)return void res.status(502).json({error:payment.error});
    await db.execute(sql`UPDATE season_official_registrations SET mp_payment_id=${payment.paymentId},mp_preference_id=NULL,updated_at=now() WHERE season_key=${KEY} AND discord_id=${session.userId}`);
    return void res.json({ok:true,paymentId:payment.paymentId,qrCode:payment.qrCode,qrCodeBase64:payment.qrCodeBase64,expiresAt:payment.expiresAt});
  }catch(error){logger.error({error},"season2 PIX creation failed");return void res.status(500).json({error:error instanceof Error?error.message:"Falha ao criar o PIX."});}
});

router.post("/season/2/inscricao-oficial/card",async(req,res)=>{
  const session=getCommunitySession(req);if(!session)return void res.status(401).json({error:"Entre com Discord para continuar."});
  if(!registrationOpen())return void res.status(410).json({error:"As inscrições da Season 2 foram encerradas."});
  try{
    await ensureTable();
    const linked=await getLinkedSteamV2(session.userId);if(!linked?.steamId)return void res.status(409).json({error:"Vincule sua Steam antes de confirmar a inscrição."});
    const parsed=validate(req.body);if("error"in parsed)return void res.status(400).json({error:parsed.error});
    await savePending(session.userId,session.username,linked.steamId,parsed);
    const preference=await createCardPreference({amount:PRICE,title:"Inscrição Season 2 Guerra Fria",discordUserId:session.userId,steamId:linked.steamId,vipTier:PAYMENT_TIER});
    if(!preference)return void res.status(502).json({error:"Não foi possível abrir o checkout do Mercado Pago."});
    await db.execute(sql`UPDATE season_official_registrations SET mp_preference_id=${preference.preferenceId},updated_at=now() WHERE season_key=${KEY} AND discord_id=${session.userId}`);
    return void res.json({ok:true,checkoutUrl:preference.checkoutUrl});
  }catch(error){logger.error({error},"season2 card checkout failed");return void res.status(500).json({error:error instanceof Error?error.message:"Falha ao abrir o pagamento."});}
});

router.post("/season/2/inscricao-oficial/confirmar",async(req,res)=>{
  const session=getCommunitySession(req);if(!session)return void res.status(401).json({error:"Entre com Discord para continuar."});
  try{
    const paymentId=clean(req.body?.paymentId,80);if(!paymentId)return void res.status(400).json({error:"Pagamento não informado."});
    const payment=await fetchMpPayment(paymentId);if(payment)await processSeason2Payment(payment);
    const current:any=await db.execute(sql`SELECT status FROM season_official_registrations WHERE season_key=${KEY} AND discord_id=${session.userId} LIMIT 1`);
    const registered=current?.rows?.[0]?.status==="active";
    return void res.json({ok:true,registered,status:registered?"active":String(payment?.status||"pending")});
  }catch(error){logger.error({error},"season2 payment confirmation failed");return void res.status(500).json({error:"Falha ao confirmar pagamento."});}
});

router.get("/season/2/inscricao-oficial",async(req,res)=>{
  const session=getCommunitySession(req);if(!session)return void res.redirect("/api/admin/auth/login?target=season");
  try{
    await ensureTable();
    const linked=await getLinkedSteamV2(session.userId);if(!linked?.steamId){res.setHeader("Cache-Control","no-store");return void res.type("html").send(steamGate(session.username));}
    const result:any=await db.execute(sql`SELECT status,steam_id,full_name,contact_email,prize_pix_type,prize_pix_key,created_at FROM season_official_registrations WHERE season_key=${KEY} AND discord_id=${session.userId} LIMIT 1`);
    const row=result?.rows?.[0];
    const active=row?.status==="active";
    const base=`<a class="back" href="/season2">← VOLTAR PARA A SEASON 2</a><section class="hero"><span class="tag">🏆 INSCRIÇÕES JÁ ABERTAS • SEASON 2</span><h1>${active?"Você está dentro.":"Entre na disputa."}</h1><p>As inscrições pagas já estão abertas por <b>R$ 20</b>. A disputa começa somente em <b>09/10/2026 às 18:30</b>, com 15 patentes, conquistas, destaques por categoria e <b>R$ 500 de premiação garantida</b>.</p></section><div class="facts"><div class="fact"><small>INÍCIO</small><b>09/10 • 18:30</b></div><div class="fact"><small>FIM</small><b>31/10 • 23:59</b></div><div class="fact"><small>INSCRIÇÃO</small><b>R$ 20</b></div><div class="fact"><small>PRÊMIO</small><b>R$ 500</b></div></div><section class="card prize"><h2>Premiação garantida</h2><div class="prizeGrid"><div class="award"><span>🥇</span><b>R$ ${SEASON_2_PRIZE.first}</b><small>50% • 1º lugar</small></div><div class="award"><span>🥈</span><b>R$ ${SEASON_2_PRIZE.second}</b><small>30% • 2º lugar</small></div><div class="award"><span>🥉</span><b>${SEASON_2_PRIZE.third}</b><small>3º lugar</small></div></div></section>`;
    if(active){
      return void res.type("html").send(shell(base+`<section class="card ok"><div class="profile"><div><span class="pill">✓ INSCRIÇÃO CONFIRMADA</span><h2>${esc(row.full_name||session.username)}</h2><p>Discord: <b>${esc(session.username)}</b><br>SteamID: <b>${esc(row.steam_id)}</b></p></div><strong>SEASON 2</strong></div><div class="actions"><a class="btn" href="/season2#ranking">VER MEU RANKING</a><a class="btn" href="/season2/guia">GUIA DA SEASON</a><a class="btn" href="/doar" style="background:linear-gradient(135deg,#d18a18,#7c4708);border-color:#e4a83c">APOIAR O SERVIDOR</a></div></section>`));
    }
    if(!registrationOpen())return void res.type("html").send(shell(base+`<div class="notice"><b>Inscrições encerradas.</b><br>O prazo terminou em ${SEASON_2_REGISTRATION_DEADLINE}.</div>`));
    return void res.type("html").send(shell(base+`<section class="card"><h2>Inscrição paga • R$ 20</h2><p>Preencha seus dados e escolha PIX ou cartão. A chave PIX informada abaixo será usada somente caso você termine em uma posição premiada.</p><div class="grid"><div class="field"><label>NOME COMPLETO</label><input id="name" autocomplete="name" placeholder="Nome e sobrenome"></div><div class="field"><label>E-MAIL</label><input id="email" type="email" autocomplete="email" placeholder="voce@email.com"></div><div class="field"><label>TIPO DA CHAVE PIX</label><select id="pixType"><option value="">Selecione</option><option value="cpf">CPF</option><option value="email">E-mail</option><option value="telefone">Telefone</option><option value="aleatoria">Aleatória</option></select></div><div class="field"><label>CHAVE PIX PARA PREMIAÇÃO</label><input id="pixKey" placeholder="Sua chave PIX"></div></div><label class="check"><input id="accept" type="checkbox"><span>Li e aceito o <a href="/api/season/2/regras" style="color:#86efac">regulamento da Season 2</a> e a cobrança única de R$ 20.</span></label><div class="grid"><button class="btn" id="payPix">PAGAR R$ 20 COM PIX</button><button class="btn" id="payCard">PAGAR R$ 20 COM CARTÃO</button></div><div class="msg" id="msg"></div><div id="qr" style="display:none;margin-top:14px;text-align:center"><img id="qrImg" alt="QR Code PIX" style="width:min(280px,100%);background:white;padding:10px;border-radius:12px"><textarea id="qrCode" readonly style="width:100%;min-height:90px;margin-top:9px;background:#080d0a;color:#fff;border:1px solid #344139;border-radius:10px;padding:10px"></textarea><button class="btn" id="copy" type="button">COPIAR PIX</button></div></section><script>
const msg=document.getElementById('msg'),pixBtn=document.getElementById('payPix'),cardBtn=document.getElementById('payCard');function payload(){return{fullName:document.getElementById('name').value,contactEmail:document.getElementById('email').value,pixType:document.getElementById('pixType').value,pixKey:document.getElementById('pixKey').value,accept:document.getElementById('accept').checked}}async function pay(method){if(!payload().accept){msg.textContent='Aceite o regulamento para continuar.';return}pixBtn.disabled=cardBtn.disabled=true;msg.textContent='Abrindo pagamento seguro no Mercado Pago...';try{const r=await fetch('/api/season/2/inscricao-oficial/'+method,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload())}),d=await r.json();if(!r.ok)throw new Error(d.error||'Falha ao abrir pagamento');if(method==='card'){location.href=d.checkoutUrl;return}document.getElementById('qr').style.display='block';document.getElementById('qrImg').src='data:image/png;base64,'+d.qrCodeBase64;document.getElementById('qrCode').value=d.qrCode;msg.style.color='#86efac';msg.textContent='PIX criado. Sua vaga será confirmada automaticamente após a aprovação.';const timer=setInterval(async()=>{const c=await fetch('/api/season/2/inscricao-oficial/confirmar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({paymentId:d.paymentId})}).then(x=>x.json()).catch(()=>null);if(c?.registered){clearInterval(timer);msg.textContent='✓ Pagamento aprovado. Inscrição confirmada!';setTimeout(()=>location.reload(),900)}},5000)}catch(e){msg.textContent='❌ '+e.message;pixBtn.disabled=cardBtn.disabled=false}}pixBtn.onclick=()=>pay('pix');cardBtn.onclick=()=>pay('card');document.getElementById('copy').onclick=()=>navigator.clipboard.writeText(document.getElementById('qrCode').value);
</script>`));
  }catch(error){logger.error({error},"season2 page failed");return void res.status(500).send("Falha ao abrir a inscrição da Season 2.");}
});

router.get("/season/2/regras",(_req,res)=>{res.setHeader("Cache-Control","no-store");return void res.type("html").send(rulesPage());});

router.get("/season/2/steam-oficial/login",(req,res)=>{
  const session=getCommunitySession(req);if(!session)return void res.redirect("/api/admin/auth/login?target=season");
  const q=new URLSearchParams({
    "openid.ns":"http://specs.openid.net/auth/2.0","openid.mode":"checkid_setup","openid.return_to":STEAM_CALLBACK_URL,
    "openid.realm":BASE_URL,"openid.identity":"http://specs.openid.net/auth/2.0/identifier_select","openid.claimed_id":"http://specs.openid.net/auth/2.0/identifier_select"
  });
  return void res.redirect(`${STEAM_OPENID}?${q.toString()}`);
});

router.get("/season/2/steam-oficial/callback",async(req,res)=>{
  const session=getCommunitySession(req);if(!session)return void res.redirect("/api/admin/auth/login?target=season");
  try{
    const params=new URLSearchParams();
    for(const [key,value] of Object.entries(req.query))if(key.startsWith("openid.")&&typeof value==="string")params.set(key,value);
    params.set("openid.mode","check_authentication");
    const verify=await fetch(STEAM_OPENID,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:params});
    const responseText=await verify.text();if(!verify.ok||!/is_valid\s*:\s*true/i.test(responseText))throw new Error("A Steam não confirmou a autenticação.");
    const claimed=typeof req.query["openid.claimed_id"]==="string"?String(req.query["openid.claimed_id"]):"";
    const match=claimed.match(/^https?:\/\/steamcommunity\.com\/openid\/id\/(7656119\d{10})\/?$/i);if(!match)throw new Error("SteamID inválido retornado pela Steam.");
    const saved=await saveLinkedSteamV2(session.userId,match[1]);
    if(!saved.ok&&saved.reason==="steam-linked")throw new Error("Esta Steam já está vinculada a outra conta Discord.");
    if(!saved.ok)throw new Error("Seu Discord já possui outra Steam vinculada. Abra um ticket para alterar a conta.");
    return void res.redirect(`${REGISTRATION_PATH}?steam=ok`);
  }catch(error){logger.error({error},"season2 Steam OpenID callback failed");return void res.redirect(`${REGISTRATION_PATH}?steam=error`);}
});

export default router;

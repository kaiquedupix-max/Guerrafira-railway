import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";

const OFFICIAL_KEY=101;
const START="04/09/2026 às 18:30";
const PRICE=20;

type Registration={discord_id:string;discord_name:string;steam_id:string;full_name:string;contact_email:string;whatsapp:string};

function digits(v:string){return String(v||"").replace(/\D/g,"")}
function waNumber(v:string){const d=digits(v);return d.startsWith("55")?d:`55${d}`}

async function ensureDeliveryColumns(){
  await db.execute(sql`ALTER TABLE season_official_registrations ADD COLUMN IF NOT EXISTS confirmation_email_sent_at TIMESTAMPTZ`);
  await db.execute(sql`ALTER TABLE season_official_registrations ADD COLUMN IF NOT EXISTS confirmation_whatsapp_sent_at TIMESTAMPTZ`);
  await db.execute(sql`ALTER TABLE season_official_registrations ADD COLUMN IF NOT EXISTS confirmation_email_status TEXT`);
  await db.execute(sql`ALTER TABLE season_official_registrations ADD COLUMN IF NOT EXISTS confirmation_whatsapp_status TEXT`);
  await db.execute(sql`ALTER TABLE season_official_registrations ADD COLUMN IF NOT EXISTS confirmation_last_error TEXT`);
}

async function getRegistration(discordId:string):Promise<Registration|null>{
  await ensureDeliveryColumns();
  const r:any=await db.execute(sql`SELECT discord_id,discord_name,steam_id,full_name,contact_email,whatsapp FROM season_official_registrations WHERE season_key=${OFFICIAL_KEY} AND discord_id=${discordId} LIMIT 1`);
  return r?.rows?.[0]||null;
}

async function sendEmail(row:Registration):Promise<"sent"|"simulated"|"skipped">{
  const state:any=await db.execute(sql`SELECT confirmation_email_sent_at FROM season_official_registrations WHERE season_key=${OFFICIAL_KEY} AND discord_id=${row.discord_id} LIMIT 1`);
  if(state?.rows?.[0]?.confirmation_email_sent_at)return "skipped";
  const mode=String(process.env.SEASON_EMAIL_MODE||"simulation").toLowerCase();
  const key=String(process.env.RESEND_API_KEY||"");
  const from=String(process.env.SEASON_EMAIL_FROM||"Guerra Fria <onboarding@resend.dev>");
  if(mode!=="live"||!key){
    logger.info({to:row.contact_email,name:row.full_name},"[SIMULACAO] email de confirmacao Season 1");
    await db.execute(sql`UPDATE season_official_registrations SET confirmation_email_status='simulated' WHERE season_key=${OFFICIAL_KEY} AND discord_id=${row.discord_id}`);
    return "simulated";
  }
  const html=`<div style="font-family:Arial,sans-serif;background:#0b0d10;color:#f7f7f7;padding:28px"><div style="max-width:620px;margin:auto;background:#14171c;border:1px solid #343941;border-radius:18px;padding:26px"><div style="color:#ef4444;font-weight:800">GUERRA FRIA • SEASON 1</div><h1>Inscrição confirmada ✅</h1><p>Olá, <b>${row.full_name}</b>!</p><p>Seu pagamento de <b>R$ ${PRICE.toFixed(2).replace('.',',')}</b> foi confirmado e sua inscrição na Season 1 oficial está ativa.</p><p><b>Início:</b> ${START}<br><b>Steam:</b> ${row.steam_id}<br><b>Discord:</b> ${row.discord_name}</p><p>Guarde este e-mail como comprovante da sua inscrição. Boa sorte na Season! ❄️🏆</p></div></div>`;
  const resp=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${key}`,"Content-Type":"application/json"},body:JSON.stringify({from,to:[row.contact_email],subject:"Inscrição confirmada • Guerra Fria Season 1",html})});
  if(!resp.ok)throw new Error(`Resend ${resp.status}: ${(await resp.text()).slice(0,300)}`);
  await db.execute(sql`UPDATE season_official_registrations SET confirmation_email_sent_at=now(),confirmation_email_status='sent' WHERE season_key=${OFFICIAL_KEY} AND discord_id=${row.discord_id}`);
  return "sent";
}

async function sendWhatsApp(row:Registration):Promise<"sent"|"simulated"|"skipped">{
  const state:any=await db.execute(sql`SELECT confirmation_whatsapp_sent_at FROM season_official_registrations WHERE season_key=${OFFICIAL_KEY} AND discord_id=${row.discord_id} LIMIT 1`);
  if(state?.rows?.[0]?.confirmation_whatsapp_sent_at)return "skipped";
  const mode=String(process.env.SEASON_WHATSAPP_MODE||"simulation").toLowerCase();
  const token=String(process.env.WHATSAPP_ACCESS_TOKEN||"");
  const phoneId=String(process.env.WHATSAPP_PHONE_NUMBER_ID||"");
  if(mode!=="live"||!token||!phoneId){
    logger.info({to:waNumber(row.whatsapp),name:row.full_name},"[SIMULACAO] WhatsApp de confirmacao Season 1");
    await db.execute(sql`UPDATE season_official_registrations SET confirmation_whatsapp_status='simulated' WHERE season_key=${OFFICIAL_KEY} AND discord_id=${row.discord_id}`);
    return "simulated";
  }
  const template=String(process.env.WHATSAPP_SEASON_TEMPLATE||"season_1_confirmada");
  const lang=String(process.env.WHATSAPP_TEMPLATE_LANGUAGE||"pt_BR");
  const body={messaging_product:"whatsapp",to:waNumber(row.whatsapp),type:"template",template:{name:template,language:{code:lang},components:[{type:"body",parameters:[{type:"text",text:row.full_name},{type:"text",text:"R$ 20,00"},{type:"text",text:START}]}]}};
  const resp=await fetch(`https://graph.facebook.com/v23.0/${encodeURIComponent(phoneId)}/messages`,{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify(body)});
  if(!resp.ok)throw new Error(`WhatsApp ${resp.status}: ${(await resp.text()).slice(0,300)}`);
  await db.execute(sql`UPDATE season_official_registrations SET confirmation_whatsapp_sent_at=now(),confirmation_whatsapp_status='sent' WHERE season_key=${OFFICIAL_KEY} AND discord_id=${row.discord_id}`);
  return "sent";
}

export async function sendSeasonRegistrationConfirmations(discordId:string){
  const row=await getRegistration(discordId);if(!row||!row.contact_email||!row.whatsapp)return {email:"skipped",whatsapp:"skipped"};
  let email="skipped",whatsapp="skipped",lastError="";
  try{email=await sendEmail(row)}catch(e:any){lastError=`email: ${String(e?.message||e)}`;logger.error({error:e,discordId},"Season confirmation email failed")}
  try{whatsapp=await sendWhatsApp(row)}catch(e:any){lastError+=(lastError?" | ":"")+`whatsapp: ${String(e?.message||e)}`;logger.error({error:e,discordId},"Season confirmation WhatsApp failed")}
  if(lastError)await db.execute(sql`UPDATE season_official_registrations SET confirmation_last_error=${lastError.slice(0,900)} WHERE season_key=${OFFICIAL_KEY} AND discord_id=${discordId}`);
  return {email,whatsapp};
}

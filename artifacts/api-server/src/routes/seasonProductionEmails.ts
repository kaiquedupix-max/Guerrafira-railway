import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";

export const PROD_SEASON_KEY = 101;
export const PROD_SEASON_START = "04/09/2026 às 18:30";
export const PROD_SEASON_END = "30/09/2026 às 23:59";
export const PROD_RULES_URL = "https://www.guerrafriarust.com.br/api/season/1/regras";
export const PROD_SEASON_URL = "https://www.guerrafriarust.com.br/season1";
export const PROD_SIGNUP_URL = "https://www.guerrafriarust.com.br/api/season/1/inscricao-oficial";

export type EntryType = "free" | "paid";
export type ProdRegistration = {
  discord_id: string;
  discord_name: string;
  steam_id: string;
  full_name: string;
  contact_email: string;
  entry_type?: string | null;
};
export type ProdWinner = { position:number; name:string; prize:string };

type Template = "confirmation" | "start" | "end" | "rules";

const esc=(v:unknown)=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]||c));
const modeOf=(row:ProdRegistration):EntryType=>String(row.entry_type||"paid").toLowerCase()==="free"?"free":"paid";
const button=(label:string,href:string,kind:"red"|"gold"="red")=>`<a href="${href}" style="display:inline-block;text-decoration:none;background:${kind==="gold"?"#b7791f":"#dc2626"};color:#fff;border:1px solid ${kind==="gold"?"#f59e0b":"#ef4444"};border-radius:10px;padding:13px 17px;font-size:12px;font-weight:800">${esc(label)}</a>`;

function shell(title:string,subtitle:string,body:string,code:string,preheader:string){
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#07090c;color:#e5e7eb;font-family:Arial,Helvetica,sans-serif"><div style="display:none;max-height:0;overflow:hidden">${esc(preheader)}</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#07090c;padding:28px 12px"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:690px;background:#101419;border:1px solid #303641;border-radius:18px;overflow:hidden"><tr><td style="padding:27px 30px;background:linear-gradient(135deg,#2a0d11,#11151b);border-bottom:1px solid #4a242a"><div style="font-size:10px;color:#fca5a5;font-weight:800;letter-spacing:.18em">GUERRA FRIA • DOCUMENTO OFICIAL • SEASON 1</div><h1 style="margin:10px 0 5px;font-size:30px;line-height:1.1;color:#fff">${title}</h1><div style="font-size:13px;color:#b8c0ca;line-height:1.55">${subtitle}</div></td></tr><tr><td style="padding:28px 30px">${body}<div style="margin-top:26px;padding-top:18px;border-top:1px solid #2b313a;color:#737d89;font-size:10px;line-height:1.7">Documento: <b style="color:#aeb6c1">${esc(code)}</b><br>Emitido eletronicamente pelo sistema oficial do Guerra Fria. Nunca envie senhas, códigos de autenticação ou credenciais em resposta a este e-mail.</div></td></tr></table><div style="max-width:690px;padding:14px 8px;color:#59616c;font-size:9px;line-height:1.6;text-align:center">Guerra Fria • Rust Server • Comunicação transacional da Season 1</div></td></tr></table></body></html>`;
}

function identity(row:ProdRegistration){
  const type=modeOf(row);
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:18px 0;background:#0b0f14;border:1px solid #303741;border-radius:12px"><tr><td style="padding:16px 18px;font-size:12px;line-height:1.9;color:#cbd2da"><b style="color:#fff">Participante:</b> ${esc(row.full_name||row.discord_name)}<br><b style="color:#fff">Discord:</b> ${esc(row.discord_name)}<br><b style="color:#fff">SteamID:</b> ${esc(row.steam_id)}<br><b style="color:#fff">Modalidade:</b> ${type==="free"?"GRATUITA • premiação exclusivamente em VIP":"PREMIADA • elegível à premiação em dinheiro"}<br><b style="color:#fff">Período:</b> ${PROD_SEASON_START} até ${PROD_SEASON_END}</td></tr></table>`;
}

function modalityBox(row:ProdRegistration){
  if(modeOf(row)==="free") return `<div style="margin:18px 0;padding:17px 18px;border-left:4px solid #38bdf8;background:#0c1b24;border-radius:8px"><b style="display:block;color:#bae6fd;font-size:13px;margin-bottom:7px">Sua inscrição é GRATUITA</b><div style="color:#c9dce7;font-size:12px;line-height:1.75">Você participa normalmente do ranking, patentes e classificação oficial, porém <b style="color:#fff">não concorre ao prêmio em dinheiro</b>. Na modalidade gratuita, a premiação é concedida exclusivamente em <b style="color:#fff">VIP, conforme o regulamento vigente</b>. Se quiser disputar os prêmios em dinheiro real, faça o upgrade da inscrição antes do encerramento permitido.</div><div style="margin-top:15px">${button("UPAR INSCRIÇÃO • CONCORRER A DINHEIRO",PROD_SIGNUP_URL,"gold")}</div></div>`;
  return `<div style="margin:18px 0;padding:17px 18px;border-left:4px solid #f59e0b;background:#21180b;border-radius:8px"><b style="display:block;color:#fde68a;font-size:13px;margin-bottom:7px">Sua inscrição é PREMIADA</b><div style="color:#ddd4bf;font-size:12px;line-height:1.75">Sua inscrição de <b style="color:#fff">R$ 20,00</b> está vinculada à modalidade que concorre à premiação em <b style="color:#fff">dinheiro real</b>, respeitando os critérios de elegibilidade, classificação e integridade descritos no regulamento.</div></div>`;
}

export function buildProductionSeasonEmail(template:Template,row:ProdRegistration,winners:ProdWinner[]=[]){
  const name=esc(row.full_name||row.discord_name||"Participante");
  const type=modeOf(row);
  if(template==="confirmation"){
    const subject=type==="free"?"Inscrição GRATUITA confirmada • Guerra Fria Season 1":"Inscrição PREMIADA confirmada • Guerra Fria Season 1";
    const body=`<p style="margin:0;color:#d8dee6;font-size:14px;line-height:1.75">Olá, <b style="color:#fff">${name}</b>.</p><p style="color:#c6cdd6;font-size:13px;line-height:1.75">Este documento confirma sua participação oficial na <b style="color:#fff">Guerra Fria Season 1</b>. Seu cadastro está vinculado ao Discord e à Steam informados na inscrição.</p>${identity(row)}${modalityBox(row)}<div style="margin:18px 0;padding:16px 18px;border-left:4px solid #ef4444;background:#250d10;border-radius:8px"><b style="display:block;color:#fecaca;font-size:13px;margin-bottom:7px">Aceite dos termos e responsabilidade do participante</b><div style="color:#e2c9cc;font-size:12px;line-height:1.75">Ao concluir sua inscrição, você declarou ciência e concordância com os termos e regras da Season. Para não ser prejudicado por perda de XP, ajustes, desclassificação ou outras medidas previstas, <b style="color:#fff">leia o regulamento completo antes de competir</b>. O desconhecimento de uma regra não impede sua aplicação.</div></div><p style="color:#aeb7c2;font-size:12px;line-height:1.7">Guarde este e-mail como comprovante eletrônico da modalidade escolhida e da confirmação da sua inscrição.</p><div style="margin-top:20px">${button("LER REGULAMENTO OFICIAL",PROD_RULES_URL)} <span style="display:inline-block;width:6px"></span>${button("ABRIR MINHA SEASON",PROD_SEASON_URL)}</div>`;
    return {subject,html:shell(type==="free"?"Inscrição gratuita confirmada":"Inscrição premiada confirmada",type==="free"?"Participação oficial com premiação em VIP.":"Participação oficial elegível à premiação em dinheiro real.",body,`GF-S1-${type==="free"?"FREE":"PAID"}-${row.discord_id}`,"Sua inscrição na Guerra Fria Season 1 foi confirmada.")};
  }
  if(template==="start"){
    const subject="A Guerra Fria Season 1 começou • Comunicado oficial";
    const body=`<p style="margin:0;color:#d8dee6;font-size:14px;line-height:1.75">Olá, <b style="color:#fff">${name}</b>.</p><p style="color:#c6cdd6;font-size:13px;line-height:1.75">A <b style="color:#fff">Guerra Fria Season 1 está oficialmente iniciada</b>. A partir de ${PROD_SEASON_START}, as ações válidas passam a compor a classificação oficial.</p>${identity(row)}${modalityBox(row)}<div style="margin:18px 0;padding:16px 18px;border-left:4px solid #22c55e;background:#0d2118;border-radius:8px;color:#c9f6d8;font-size:12px;line-height:1.75"><b style="color:#fff">Antes de jogar:</b> confira sua Steam vinculada, sua modalidade e releia as regras. Toda pontuação oficial estará sujeita aos filtros e auditorias de integridade da Season.</div><div style="margin-top:20px">${button("ABRIR RANKING AO VIVO",PROD_SEASON_URL)} <span style="display:inline-block;width:6px"></span>${button("CONSULTAR REGRAS",PROD_RULES_URL)}</div>`;
    return {subject,html:shell("Season 1 oficialmente iniciada","A classificação oficial já está valendo.",body,`GF-S1-INI-${row.discord_id}`,"A Season 1 começou. Confira sua modalidade e as regras.")};
  }
  if(template==="end"){
    const podium=winners.length?winners.map(w=>`<tr><td style="padding:11px;border-bottom:1px solid #2b313a;color:#fff;font-weight:800">${w.position}º</td><td style="padding:11px;border-bottom:1px solid #2b313a;color:#d8dee6">${esc(w.name)}</td><td style="padding:11px;border-bottom:1px solid #2b313a;color:#fbbf24;font-weight:800">${esc(w.prize)}</td></tr>`).join(""):`<tr><td colspan="3" style="padding:14px;color:#9ca3af">Resultado final em validação pela administração.</td></tr>`;
    const body=`<p style="margin:0;color:#d8dee6;font-size:14px;line-height:1.75">Olá, <b style="color:#fff">${name}</b>.</p><p style="color:#c6cdd6;font-size:13px;line-height:1.75">A Guerra Fria Season 1 foi encerrada em <b style="color:#fff">${PROD_SEASON_END}</b>. Agradecemos sua participação.</p>${identity(row)}<h2 style="font-size:17px;color:#fff;margin:22px 0 10px">Campeões da modalidade premiada</h2><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #343b45;border-radius:10px;overflow:hidden;background:#0b0f14"><tr><th align="left" style="padding:10px;color:#8f98a5;font-size:10px">POS.</th><th align="left" style="padding:10px;color:#8f98a5;font-size:10px">CAMPEÃO</th><th align="left" style="padding:10px;color:#8f98a5;font-size:10px">PREMIAÇÃO</th></tr>${podium}</table>${type==="free"?`<div style="margin:18px 0;padding:17px;border-left:4px solid #38bdf8;background:#0c1b24;border-radius:8px;color:#c9dce7;font-size:12px;line-height:1.75">Você participou pela modalidade <b style="color:#fff">gratuita</b>. Nesta modalidade, a premiação aplicável é em <b style="color:#fff">VIP conforme o regulamento</b>; os valores em dinheiro pertencem exclusivamente à modalidade premiada.</div>`:""}<div style="margin:18px 0;padding:17px;border-left:4px solid #22c55e;background:#0d2118;border-radius:8px;color:#c9f6d8;font-size:12px;line-height:1.75"><b style="color:#fff">Entrega das premiações:</b> após a validação final de integridade, as premiações devidas serão processadas em até <b>24 horas após o encerramento</b>.</div><div style="margin-top:20px">${button("VER CLASSIFICAÇÃO FINAL",PROD_SEASON_URL)}</div>`;
    return {subject:"Encerramento oficial • Campeões da Guerra Fria Season 1",html:shell("Encerramento da Season 1","Resultado oficial, modalidade e prazo de entrega das premiações.",body,`GF-S1-FIM-${row.discord_id}`,"A Season 1 terminou. Veja o resultado e o prazo de premiação.")};
  }
  const body=`<p style="margin:0;color:#d8dee6;font-size:14px;line-height:1.75">Olá, <b style="color:#fff">${name}</b>.</p>${identity(row)}${modalityBox(row)}<p style="color:#c6cdd6;font-size:13px;line-height:1.75">Leia o regulamento oficial para entender pontuação, auditorias, condutas proibidas, critérios de elegibilidade e diferenças entre as modalidades gratuita e premiada.</p><div style="margin-top:20px">${button("LER REGRAS AGORA",PROD_RULES_URL)}</div>`;
  return {subject:"Aviso oficial • Regulamento da Guerra Fria Season 1",html:shell("Comunicado de regulamento","Regras e modalidade da sua inscrição.",body,`GF-S1-REG-${row.discord_id}`,"Leia as regras da Season para evitar prejuízos competitivos.")};
}

async function ensureInfra(){
  await db.execute(sql`CREATE TABLE IF NOT EXISTS season_email_log(id BIGSERIAL PRIMARY KEY,season_key INTEGER NOT NULL,discord_id TEXT,contact_email TEXT NOT NULL,template_key TEXT NOT NULL,subject TEXT NOT NULL,mode TEXT NOT NULL,status TEXT NOT NULL,provider_id TEXT,error TEXT,sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),admin_name TEXT)`);
}

export async function sendProductionSeasonEmail(args:{row:ProdRegistration;template:Template;winners?:ProdWinner[];adminName?:string;force?:boolean}){
  await ensureInfra();
  const mode=String(process.env.SEASON_EMAIL_MODE||"simulation").toLowerCase()==="live"?"live":"simulation";
  const built=buildProductionSeasonEmail(args.template,args.row,args.winners||[]);
  if(!args.force){
    const old:any=await db.execute(sql`SELECT id FROM season_email_log WHERE season_key=${PROD_SEASON_KEY} AND discord_id=${args.row.discord_id} AND template_key=${args.template} AND mode=${mode} AND status IN ('sent','simulated') ORDER BY id DESC LIMIT 1`);
    if(old?.rows?.[0]) return {status:"skipped" as const,subject:built.subject};
  }
  if(mode!=="live"){
    await db.execute(sql`INSERT INTO season_email_log(season_key,discord_id,contact_email,template_key,subject,mode,status,admin_name) VALUES(${PROD_SEASON_KEY},${args.row.discord_id},${args.row.contact_email},${args.template},${built.subject},'simulation','simulated',${args.adminName||null})`);
    logger.info({discordId:args.row.discord_id,template:args.template},"[SIMULACAO] Season production email");
    return {status:"simulated" as const,subject:built.subject};
  }
  const key=String(process.env.RESEND_API_KEY||"").trim();
  if(!key) throw new Error("RESEND_API_KEY ausente");
  const from=String(process.env.SEASON_EMAIL_FROM||"Guerra Fria Season <season@guerrafriarust.com.br>").trim();
  const resp=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${key}`,"Content-Type":"application/json"},body:JSON.stringify({from,to:[args.row.contact_email],subject:built.subject,html:built.html})});
  const text=await resp.text();
  if(!resp.ok){
    await db.execute(sql`INSERT INTO season_email_log(season_key,discord_id,contact_email,template_key,subject,mode,status,error,admin_name) VALUES(${PROD_SEASON_KEY},${args.row.discord_id},${args.row.contact_email},${args.template},${built.subject},'live','failed',${text.slice(0,900)},${args.adminName||null})`);
    throw new Error(`Resend ${resp.status}: ${text.slice(0,300)}`);
  }
  let providerId=""; try{providerId=String(JSON.parse(text)?.id||"")}catch{}
  await db.execute(sql`INSERT INTO season_email_log(season_key,discord_id,contact_email,template_key,subject,mode,status,provider_id,admin_name) VALUES(${PROD_SEASON_KEY},${args.row.discord_id},${args.row.contact_email},${args.template},${built.subject},'live','sent',${providerId||null},${args.adminName||null})`);
  return {status:"sent" as const,subject:built.subject,providerId};
}

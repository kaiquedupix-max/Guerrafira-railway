import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";

export const SEASON_OFFICIAL_KEY = 101;
export const SEASON_START_LABEL = "04/09/2026 às 18:30";
export const SEASON_END_LABEL = "30/09/2026 às 23:59";
export const SEASON_START_AT = Date.parse("2026-09-04T18:30:00-03:00");
export const SEASON_END_AT = Date.parse("2026-09-30T23:59:00-03:00");
export const SEASON_RULES_URL = "https://www.guerrafriarust.com.br/api/season/1/regras";
export const SEASON_PAGE_URL = "https://www.guerrafriarust.com.br/season1";

export type SeasonEmailTemplate = "confirmation" | "rules" | "start" | "end";
export type SeasonEmailRegistration = {
  discord_id: string;
  discord_name: string;
  steam_id: string;
  full_name: string;
  contact_email: string;
};
export type SeasonWinner = { position: number; name: string; discordName: string; steamId: string; xp: number; prize: string };

const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, c => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
}[c] || c));

export function seasonEmailMode() {
  return String(process.env.SEASON_EMAIL_MODE || "simulation").toLowerCase() === "live" ? "live" : "simulation";
}

export async function ensureSeasonEmailInfrastructure() {
  await db.execute(sql`CREATE TABLE IF NOT EXISTS season_email_log (
    id BIGSERIAL PRIMARY KEY,
    season_key INTEGER NOT NULL,
    discord_id TEXT,
    contact_email TEXT NOT NULL,
    template_key TEXT NOT NULL,
    subject TEXT NOT NULL,
    mode TEXT NOT NULL,
    status TEXT NOT NULL,
    provider_id TEXT,
    error TEXT,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    admin_name TEXT
  )`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS season_email_log_lookup ON season_email_log(season_key,template_key,discord_id,mode,status)`);
  await db.execute(sql`CREATE TABLE IF NOT EXISTS season_email_lifecycle (
    marker_key TEXT PRIMARY KEY,
    completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    details TEXT
  )`);
}

function button(label: string, href: string) {
  return `<a href="${href}" style="display:inline-block;text-decoration:none;background:#ef4444;color:#fff;border:1px solid #fb7185;border-radius:10px;padding:12px 17px;font-size:12px;font-weight:800;letter-spacing:.03em">${label}</a>`;
}

function documentShell(args: { preheader: string; title: string; subtitle: string; body: string; documentCode: string }) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#080a0d;color:#e5e7eb;font-family:Arial,Helvetica,sans-serif"><div style="display:none;max-height:0;overflow:hidden">${esc(args.preheader)}</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#080a0d;padding:28px 12px"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:680px;background:#101419;border:1px solid #313844;border-radius:18px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.35)"><tr><td style="padding:26px 30px;background:linear-gradient(135deg,#2a0d11,#11151b);border-bottom:1px solid #4a242a"><div style="font-size:10px;color:#fca5a5;font-weight:800;letter-spacing:.18em">GUERRA FRIA • DOCUMENTO OFICIAL • SEASON 1</div><h1 style="margin:10px 0 5px;font-size:30px;line-height:1.1;color:#fff">${args.title}</h1><div style="font-size:13px;color:#b8c0ca;line-height:1.5">${args.subtitle}</div></td></tr><tr><td style="padding:28px 30px">${args.body}<div style="margin-top:26px;padding-top:18px;border-top:1px solid #2b313a;color:#737d89;font-size:10px;line-height:1.7">Documento: <b style="color:#aeb6c1">${esc(args.documentCode)}</b><br>Emitido eletronicamente pelo sistema oficial do Guerra Fria. Não responda com dados bancários, senhas ou códigos de autenticação.</div></td></tr></table><div style="max-width:680px;padding:14px 8px;color:#59616c;font-size:9px;line-height:1.6;text-align:center">Guerra Fria • Rust Server • Comunicação transacional referente à Season 1</div></td></tr></table></body></html>`;
}

function infoTable(row: SeasonEmailRegistration) {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:18px 0;background:#0b0f14;border:1px solid #303741;border-radius:12px"><tr><td style="padding:16px 18px;font-size:12px;line-height:1.9;color:#cbd2da"><b style="color:#fff">Participante:</b> ${esc(row.full_name)}<br><b style="color:#fff">Discord:</b> ${esc(row.discord_name)}<br><b style="color:#fff">SteamID:</b> ${esc(row.steam_id)}<br><b style="color:#fff">Período oficial:</b> ${SEASON_START_LABEL} até ${SEASON_END_LABEL}</td></tr></table>`;
}

export function buildSeasonEmail(template: SeasonEmailTemplate, row: SeasonEmailRegistration, winners: SeasonWinner[] = []) {
  const name = esc(row.full_name || row.discord_name || "Participante");
  if (template === "confirmation") {
    const subject = "Documento de inscrição confirmado • Guerra Fria Season 1";
    const body = `<p style="margin:0;color:#d8dee6;font-size:14px;line-height:1.75">Olá, <b style="color:#fff">${name}</b>.</p><p style="color:#c6cdd6;font-size:13px;line-height:1.75">Este e-mail formaliza a confirmação da sua inscrição na <b style="color:#fff">Guerra Fria Season 1</b>. Seu cadastro foi registrado como participante ativo e ficará vinculado ao Discord e à Steam informados no momento da inscrição.</p>${infoTable(row)}<div style="margin:18px 0;padding:16px 18px;border-left:4px solid #f59e0b;background:#21180b;border-radius:8px"><b style="display:block;color:#fde68a;font-size:13px;margin-bottom:7px">Termos e regulamento</b><div style="color:#d6d0c5;font-size:12px;line-height:1.7">Ao concluir a inscrição, você confirmou ciência e concordância com os termos e regras aplicáveis à Season. Para evitar perda de pontuação, desclassificação ou qualquer outro prejuízo competitivo, <b style="color:#fff">leia o regulamento completo antes do início da temporada</b> e consulte-o novamente sempre que houver dúvida.</div></div><p style="color:#aeb7c2;font-size:12px;line-height:1.7">A administração poderá auditar eventos, corrigir pontuações indevidas e aplicar as medidas previstas no regulamento. Guarde esta mensagem como comprovante eletrônico da sua inscrição.</p><div style="margin-top:20px">${button("LER REGULAMENTO OFICIAL", SEASON_RULES_URL)} <span style="display:inline-block;width:6px"></span>${button("ABRIR MINHA SEASON", SEASON_PAGE_URL)}</div>`;
    return { subject, html: documentShell({ preheader: "Sua inscrição oficial na Guerra Fria Season 1 foi confirmada.", title: "Inscrição oficial confirmada", subtitle: "Comprovante eletrônico de participação e ciência do regulamento.", body, documentCode: `GF-S1-INS-${row.discord_id}` }) };
  }
  if (template === "rules") {
    const subject = "Aviso oficial • Leia o regulamento da Guerra Fria Season 1";
    const body = `<p style="margin:0;color:#d8dee6;font-size:14px;line-height:1.75">Olá, <b style="color:#fff">${name}</b>.</p><p style="color:#c6cdd6;font-size:13px;line-height:1.75">Este é um aviso preventivo da administração da Season 1. O regulamento define o que conta para XP, condutas proibidas, critérios de auditoria, elegibilidade e situações que podem gerar correção ou desclassificação.</p><div style="margin:18px 0;padding:17px;border:1px solid #7f1d1d;background:#260d10;border-radius:10px;color:#fecaca;font-size:12px;line-height:1.75"><b style="color:#fff">Importante:</b> desconhecer uma regra não impede sua aplicação. Para não ser prejudicado, leia o documento completo antes de continuar competindo.</div>${infoTable(row)}<div style="margin-top:20px">${button("LER REGRAS AGORA", SEASON_RULES_URL)}</div>`;
    return { subject, html: documentShell({ preheader: "Leia as regras da Season para evitar prejuízos competitivos.", title: "Comunicado de regulamento", subtitle: "Orientação oficial aos participantes inscritos.", body, documentCode: `GF-S1-REG-${row.discord_id}` }) };
  }
  if (template === "start") {
    const subject = "A Guerra Fria Season 1 começou • Comunicado oficial";
    const body = `<p style="margin:0;color:#d8dee6;font-size:14px;line-height:1.75">Olá, <b style="color:#fff">${name}</b>.</p><p style="color:#c6cdd6;font-size:13px;line-height:1.75">A <b style="color:#fff">Guerra Fria Season 1 está oficialmente iniciada</b>. A partir de ${SEASON_START_LABEL}, as ações válidas passam a compor a classificação oficial conforme o regulamento.</p><div style="margin:18px 0;padding:18px;border:1px solid #25613f;background:#0c2117;border-radius:11px"><div style="font-size:10px;color:#86efac;font-weight:800;letter-spacing:.12em">TEMPORADA OFICIAL ATIVA</div><div style="margin-top:7px;color:#d9fbe6;font-size:13px;line-height:1.8">Início: <b>${SEASON_START_LABEL}</b><br>Encerramento: <b>${SEASON_END_LABEL}</b></div></div><p style="color:#c6cdd6;font-size:12px;line-height:1.75">Recomendamos verificar seu perfil, sua Steam vinculada e reler o regulamento antes de jogar. Caso identifique divergência na classificação, utilize os canais oficiais de suporte para que a administração possa auditar o ocorrido.</p><div style="margin-top:20px">${button("ABRIR SEASON AO VIVO", SEASON_PAGE_URL)} <span style="display:inline-block;width:6px"></span>${button("CONSULTAR REGRAS", SEASON_RULES_URL)}</div>`;
    return { subject, html: documentShell({ preheader: "A Season 1 começou. Sua participação oficial já está valendo.", title: "Season 1 oficialmente iniciada", subtitle: "A classificação oficial já está em andamento.", body, documentCode: `GF-S1-INI-${row.discord_id}` }) };
  }
  const podium = winners.length ? winners.map(w => `<tr><td style="padding:11px;border-bottom:1px solid #2b313a;color:#f8fafc;font-weight:800">${w.position}º</td><td style="padding:11px;border-bottom:1px solid #2b313a;color:#d8dee6">${esc(w.name || w.discordName)}</td><td style="padding:11px;border-bottom:1px solid #2b313a;color:#fbbf24;font-weight:800">${esc(w.prize)}</td></tr>`).join("") : `<tr><td colspan="3" style="padding:14px;color:#9ca3af">Classificação final em processamento pela administração.</td></tr>`;
  const subject = "Encerramento oficial • Campeões da Guerra Fria Season 1";
  const body = `<p style="margin:0;color:#d8dee6;font-size:14px;line-height:1.75">Olá, <b style="color:#fff">${name}</b>.</p><p style="color:#c6cdd6;font-size:13px;line-height:1.75">A Guerra Fria Season 1 foi encerrada em <b style="color:#fff">${SEASON_END_LABEL}</b>. Agradecemos sua participação e competitividade durante a temporada.</p><h2 style="font-size:17px;color:#fff;margin:22px 0 10px">Classificação dos campeões</h2><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #343b45;border-radius:10px;overflow:hidden;background:#0b0f14"><tr><th align="left" style="padding:10px;color:#8f98a5;font-size:10px">POS.</th><th align="left" style="padding:10px;color:#8f98a5;font-size:10px">CAMPEÃO</th><th align="left" style="padding:10px;color:#8f98a5;font-size:10px">PREMIAÇÃO</th></tr>${podium}</table><div style="margin:18px 0;padding:17px;border-left:4px solid #22c55e;background:#0d2118;border-radius:8px;color:#c9f6d8;font-size:12px;line-height:1.75"><b style="color:#fff">Entrega da premiação:</b> os vencedores elegíveis terão a premiação processada em até <b>24 horas após o encerramento</b>, utilizando os dados cadastrados e após as validações finais de integridade previstas no regulamento.</div><p style="color:#aeb7c2;font-size:12px;line-height:1.7">Caso você esteja entre os vencedores, mantenha seus dados de recebimento corretos e acompanhe os canais oficiais. Qualquer necessidade de validação adicional será comunicada diretamente pela administração.</p><div style="margin-top:20px">${button("VER CLASSIFICAÇÃO FINAL", SEASON_PAGE_URL)}</div>`;
  return { subject, html: documentShell({ preheader: "A Season 1 terminou. Veja os campeões e o prazo de premiação.", title: "Encerramento da Season 1", subtitle: "Resultado oficial e informação sobre a entrega da premiação.", body, documentCode: `GF-S1-FIM-${row.discord_id}` }) };
}

export async function sendSeasonEmail(args: { row: SeasonEmailRegistration; template: SeasonEmailTemplate; winners?: SeasonWinner[]; adminName?: string; force?: boolean }) {
  await ensureSeasonEmailInfrastructure();
  const mode = seasonEmailMode();
  const built = buildSeasonEmail(args.template, args.row, args.winners || []);
  if (!args.force) {
    const old: any = await db.execute(sql`SELECT id,status FROM season_email_log WHERE season_key=${SEASON_OFFICIAL_KEY} AND discord_id=${args.row.discord_id} AND template_key=${args.template} AND mode=${mode} AND status IN ('sent','simulated') ORDER BY id DESC LIMIT 1`);
    if (old?.rows?.[0]) return { status: "skipped" as const, subject: built.subject };
  }
  const key = String(process.env.RESEND_API_KEY || "").trim();
  const from = String(process.env.SEASON_EMAIL_FROM || "Guerra Fria Season <season@guerrafriarust.com.br>").trim();
  if (mode !== "live" || !key) {
    logger.info({ discordId: args.row.discord_id, template: args.template }, "[SIMULACAO] email profissional da Season");
    await db.execute(sql`INSERT INTO season_email_log(season_key,discord_id,contact_email,template_key,subject,mode,status,admin_name) VALUES(${SEASON_OFFICIAL_KEY},${args.row.discord_id},${args.row.contact_email},${args.template},${built.subject},${mode},'simulated',${args.adminName || null})`);
    return { status: "simulated" as const, subject: built.subject };
  }
  try {
    const resp = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ from, to: [args.row.contact_email], subject: built.subject, html: built.html }) });
    const text = await resp.text();
    if (!resp.ok) throw new Error(`Resend ${resp.status}: ${text.slice(0, 300)}`);
    let providerId = ""; try { providerId = String(JSON.parse(text)?.id || ""); } catch {}
    await db.execute(sql`INSERT INTO season_email_log(season_key,discord_id,contact_email,template_key,subject,mode,status,provider_id,admin_name) VALUES(${SEASON_OFFICIAL_KEY},${args.row.discord_id},${args.row.contact_email},${args.template},${built.subject},${mode},'sent',${providerId || null},${args.adminName || null})`);
    return { status: "sent" as const, subject: built.subject, providerId };
  } catch (error: any) {
    const message = String(error?.message || error).slice(0, 800);
    await db.execute(sql`INSERT INTO season_email_log(season_key,discord_id,contact_email,template_key,subject,mode,status,error,admin_name) VALUES(${SEASON_OFFICIAL_KEY},${args.row.discord_id},${args.row.contact_email},${args.template},${built.subject},${mode},'failed',${message},${args.adminName || null})`);
    throw error;
  }
}

export async function getOfficialSeasonRegistrations(): Promise<SeasonEmailRegistration[]> {
  const r: any = await db.execute(sql`SELECT discord_id,discord_name,steam_id,COALESCE(full_name,discord_name) full_name,contact_email FROM season_official_registrations WHERE season_key=${SEASON_OFFICIAL_KEY} AND status='active' AND contact_email IS NOT NULL AND TRIM(contact_email)<>'' ORDER BY paid_at ASC NULLS LAST,created_at ASC`);
  return (r?.rows || []) as SeasonEmailRegistration[];
}

import { createHmac, timingSafeEqual } from "node:crypto";
import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { getCommunitySession } from "../admin/communitySession.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();
const BASE_URL = "https://www.guerrafriarust.com.br";
const STEAM_OPENID = "https://steamcommunity.com/openid/login";
const STEAM_COOKIE = "gf_season_steam";
const COOKIE_MS = 30 * 60 * 1000;
const OFFICIAL_START = Date.parse("2026-09-04T18:30:00-03:00");
const BETA_ROLE_ID = "1542955942516359289";
const DISCORD_ICON = `<img class="brandIcon" src="https://cdn.simpleicons.org/discord/5865F2" alt="Discord">`;
const STEAM_ICON = `<img class="brandIcon steamBrand" src="https://cdn.simpleicons.org/steam/FFFFFF" alt="Steam">`;

const secret = () => process.env.ADMIN_SESSION_SECRET?.trim() || process.env.DISCORD_CLIENT_SECRET?.trim() || "gf-season-steam";
const sign = (payload: string) => createHmac("sha256", secret()).update(payload).digest("base64url");
const esc = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c] || c));

async function ensureTables() {
  await db.execute(sql`CREATE TABLE IF NOT EXISTS season_registrations (
    season_number INTEGER NOT NULL,
    discord_id TEXT NOT NULL,
    discord_name TEXT NOT NULL,
    mode TEXT NOT NULL DEFAULT 'beta_free',
    status TEXT NOT NULL DEFAULT 'active',
    accepted_rules_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (season_number, discord_id)
  )`);
  await db.execute(sql`ALTER TABLE season_registrations ADD COLUMN IF NOT EXISTS steam_id TEXT`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS season_registrations_unique_steam ON season_registrations(season_number, steam_id) WHERE steam_id IS NOT NULL`);
}

function issueSteamCookie(res: any, discordId: string, steamId: string, season: number) {
  const payload = Buffer.from(JSON.stringify({ discordId, steamId, season, exp: Date.now() + COOKIE_MS }), "utf8").toString("base64url");
  res.cookie(STEAM_COOKIE, `${payload}.${sign(payload)}`, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: COOKIE_MS });
}

function readSteamCookie(req: any, discordId: string, season: number): string | null {
  const token = String(req.cookies?.[STEAM_COOKIE] || "");
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = sign(payload);
  const a = Buffer.from(signature); const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (data.discordId !== discordId || Number(data.season) !== season || Number(data.exp) < Date.now()) return null;
    const steamId = String(data.steamId || "");
    return /^7656119\d{10}$/.test(steamId) ? steamId : null;
  } catch { return null; }
}

async function assignBetaRole(discordId: string) {
  const guildId = String(process.env.DISCORD_GUILD_ID || "").trim();
  const roleId = String(process.env.SEASON_BETA_ROLE_ID || BETA_ROLE_ID).trim();
  const token = String(process.env.DISCORD_BOT_TOKEN || "").trim();
  if (!guildId || !roleId || !token) return { ok: false, reason: "Configuração do Discord incompleta" };
  const r = await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${discordId}/roles/${roleId}`, { method: "PUT", headers: { Authorization: `Bot ${token}` } });
  return r.ok ? { ok: true, reason: "" } : { ok: false, reason: `Discord HTTP ${r.status}` };
}

function page(body: string) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#08090b"><title>Inscrição Season • Guerra Fria</title><style>*{box-sizing:border-box}html,body{margin:0;min-height:100%;background:#08090b;color:#f7f7f5;font-family:Inter,system-ui,-apple-system,sans-serif}body{background:radial-gradient(circle at 50% -10%,#46160f,#171012 28%,#08090b 62%)}.wrap{width:min(760px,calc(100% - 24px));margin:auto;padding:20px 0 60px}.back,.btn{display:inline-flex;align-items:center;justify-content:center;text-decoration:none;border-radius:12px;padding:13px 16px;font-weight:950;font-size:12px}.back{border:1px solid #303641;color:#fff;background:#11141a}.hero{padding:32px 0 16px}.ey{font-size:10px;font-weight:1000;letter-spacing:.18em;color:#fca5a5}.hero h1{font-size:clamp(38px,8vw,62px);line-height:.95;letter-spacing:-.05em;margin:8px 0 12px}.hero p{color:#a0a7b2;line-height:1.65}.card{border:1px solid #343a44;background:linear-gradient(180deg,#111419,#0c0e12);border-radius:18px;padding:18px;margin:12px 0}.steps{display:grid;gap:10px}.step{display:grid;grid-template-columns:44px 1fr auto;gap:12px;align-items:center;border:1px solid #343a44;background:#101216;border-radius:14px;padding:13px}.ico{width:44px;height:44px;border-radius:12px;display:grid;place-items:center;background:#181b21;font-size:22px;overflow:hidden}.ico.discord{background:#11131d}.ico.steam{background:#101820}.brandIcon{width:27px;height:27px;display:block}.steamBrand{width:29px;height:29px}.step b{display:block}.step small{display:block;color:#9aa0aa;margin-top:4px;line-height:1.45}.ok{color:#86efac}.pending{color:#fbbf24}.btn{border:1px solid #ef4444;background:linear-gradient(135deg,#ef4444,#b91c1c);color:#fff;cursor:pointer}.btn.steam{background:linear-gradient(135deg,#1b2838,#2a475e);border-color:#66c0f4}.btn.secondary{background:#15181e;border-color:#414754}.btn[disabled]{opacity:.5}.check{display:flex;gap:10px;align-items:flex-start;color:#d4d8df;font-size:12px;line-height:1.55;margin:16px 0}.actions{display:grid;grid-template-columns:1fr 1fr;gap:9px}.msg{font-size:12px;color:#fca5a5;margin-top:12px}.notice{border:1px solid #ef444466;background:#311012;border-radius:16px;padding:15px;color:#e8c8ca;line-height:1.55;font-size:13px;margin:12px 0}.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}@media(max-width:620px){.actions{grid-template-columns:1fr}.step{grid-template-columns:44px 1fr}.step .btn{grid-column:1/-1;width:100%}}</style></head><body><main class="wrap">${body}</main></body></html>`;
}

router.get("/season/:number/inscricao", async (req, res, next) => {
  const season = Math.max(1, Math.trunc(Number(req.params.number) || 1));
  if (season !== 1) return next();
  const session = getCommunitySession(req);
  if (!session) return next();
  await ensureTables();
  const steamFromCookie = readSteamCookie(req, session.userId, season);
  const current: any = await db.execute(sql`SELECT steam_id,status,created_at FROM season_registrations WHERE season_number=${season} AND discord_id=${session.userId} LIMIT 1`);
  const row = current?.rows?.[0];
  const steamId = steamFromCookie || (row?.steam_id ? String(row.steam_id) : null);
  const registered = Boolean(row?.status === "active" && steamId);
  const body = `<a class="back" href="/season1">← Voltar para Season</a><section class="hero"><div class="ey">🧪 BETA SEASON TESTER</div><h1>Discord + Steam</h1><p>Para participar da Season, precisamos confirmar as duas contas. Isso evita cadastro errado e liga seu MMR diretamente à Steam que joga no Rust.</p></section><div class="notice"><strong>⚠️ Beta sem premiação.</strong> Esta semana serve para balanceamento, testes e correções. Resultados podem ser ajustados ou zerados antes da Season oficial.</div><section class="card"><div class="steps"><div class="step"><div class="ico discord">${DISCORD_ICON}</div><div><b>1. Discord <span class="ok">✓ conectado</span></b><small>${esc(session.username)} • ID ${esc(session.userId)}</small></div></div><div class="step"><div class="ico steam">${STEAM_ICON}</div><div><b>2. Steam ${steamId ? '<span class="ok">✓ conectada</span>' : '<span class="pending">• pendente</span>'}</b><small>${steamId ? `SteamID64 <span class="mono">${esc(steamId)}</span>` : 'Entre pelo site oficial da Steam para confirmar sua conta.'}</small></div>${steamId ? `<a class="btn steam" href="/api/season/1/steam/login">TROCAR STEAM</a>` : `<a class="btn steam" href="/api/season/1/steam/login">ENTRAR COM STEAM</a>`}</div><div class="step"><div class="ico">🎖️</div><div><b>3. Inscrição ${registered ? '<span class="ok">✓ concluída</span>' : '<span class="pending">• aguardando</span>'}</b><small>${registered ? 'Cadastro válido e cargo Season Tester aplicado.' : 'Depois de confirmar a Steam, aceite o regulamento e finalize.'}</small></div></div></div>${registered ? `<div class="msg ok">✅ Você já está inscrito como Season Tester com Discord e Steam confirmados.</div>` : steamId ? `<label class="check"><input id="accept" type="checkbox"><span>Li o <a href="/api/season/1/regras" style="color:#fca5a5">Regulamento da Season</a>, aceito os termos e entendo que esta Beta não possui premiação.</span></label><div class="actions"><a class="btn secondary" href="/api/season/1/regras">VER REGRAS</a><button class="btn" id="send">CONCLUIR INSCRIÇÃO</button></div><div id="msg" class="msg"></div><script>document.getElementById('send').onclick=async function(){var a=document.getElementById('accept'),m=document.getElementById('msg'),b=this;if(!a.checked){m.textContent='Aceite o regulamento para continuar.';return}b.disabled=true;m.textContent='Validando Discord + Steam e aplicando o cargo...';try{var r=await fetch('/api/season/1/inscricao',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({accept:true})});var j=await r.json();if(!r.ok)throw new Error(j.error||'Falha na inscrição');m.className='msg ok';m.textContent=j.message||'Inscrição concluída.';setTimeout(function(){location.reload()},900)}catch(e){m.className='msg';m.textContent=e.message;b.disabled=false}}</script>` : `<div class="msg">Conecte sua Steam para liberar a conclusão da inscrição.</div>`}</section>`;
  res.setHeader("Cache-Control", "no-store");
  return void res.status(200).type("html").send(page(body));
});

router.get("/season/:number/steam/login", (req, res) => {
  const season = Math.max(1, Math.trunc(Number(req.params.number) || 1));
  const session = getCommunitySession(req);
  if (!session) return void res.redirect(`/api/season/${season}/inscricao`);
  if (season !== 1) return void res.status(400).send("Season inválida.");
  const returnTo = `${BASE_URL}/api/season/${season}/steam/callback`;
  const q = new URLSearchParams({ "openid.ns": "http://specs.openid.net/auth/2.0", "openid.mode": "checkid_setup", "openid.return_to": returnTo, "openid.realm": BASE_URL, "openid.identity": "http://specs.openid.net/auth/2.0/identifier_select", "openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select" });
  return void res.redirect(`${STEAM_OPENID}?${q.toString()}`);
});

router.get("/season/:number/steam/callback", async (req, res) => {
  const season = Math.max(1, Math.trunc(Number(req.params.number) || 1));
  const session = getCommunitySession(req);
  if (!session) return void res.redirect(`/api/season/${season}/inscricao`);
  try {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(req.query)) if (key.startsWith("openid.") && typeof value === "string") params.set(key, value);
    params.set("openid.mode", "check_authentication");
    const verify = await fetch(STEAM_OPENID, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: params });
    const text = await verify.text();
    if (!verify.ok || !/is_valid\s*:\s*true/i.test(text)) throw new Error("Steam não confirmou a autenticação.");
    const claimed = typeof req.query["openid.claimed_id"] === "string" ? String(req.query["openid.claimed_id"]) : "";
    const match = claimed.match(/^https?:\/\/steamcommunity\.com\/openid\/id\/(7656119\d{10})\/?$/i);
    if (!match) throw new Error("SteamID inválido retornado pela Steam.");
    issueSteamCookie(res, session.userId, match[1], season);
    return void res.redirect(`/api/season/${season}/inscricao?steam=ok`);
  } catch (error) {
    logger.error({ error }, "season steam openid callback failed");
    return void res.status(401).type("html").send(page(`<a class="back" href="/api/season/${season}/inscricao">← Voltar</a><section class="hero"><div class="ey">STEAM</div><h1>Falha na autenticação</h1><p>Não foi possível confirmar sua conta Steam. Volte e tente novamente.</p></section>`));
  }
});

router.post("/season/:number/inscricao", async (req, res, next) => {
  const season = Math.max(1, Math.trunc(Number(req.params.number) || 1));
  if (season !== 1) return next();
  const session = getCommunitySession(req);
  if (!session) return void res.status(401).json({ ok: false, error: "Faça login com Discord antes de se inscrever." });
  if (Date.now() >= OFFICIAL_START) return void res.status(409).json({ ok: false, error: "A fase Beta foi encerrada. A Season oficial exige uma nova inscrição." });
  if (req.body?.accept !== true) return void res.status(400).json({ ok: false, error: "É necessário aceitar o regulamento." });
  await ensureTables();
  const existing: any = await db.execute(sql`SELECT steam_id FROM season_registrations WHERE season_number=${season} AND discord_id=${session.userId} LIMIT 1`);
  const steamId = readSteamCookie(req, session.userId, season) || (existing?.rows?.[0]?.steam_id ? String(existing.rows[0].steam_id) : null);
  if (!steamId) return void res.status(400).json({ ok: false, error: "Conecte e confirme sua Steam antes de concluir a inscrição." });
  const duplicate: any = await db.execute(sql`SELECT discord_id FROM season_registrations WHERE season_number=${season} AND steam_id=${steamId} AND discord_id<>${session.userId} LIMIT 1`);
  if (duplicate?.rows?.[0]) return void res.status(409).json({ ok: false, error: "Esta conta Steam já está vinculada a outro Discord nesta Season." });
  const role = await assignBetaRole(session.userId);
  if (!role.ok) return void res.status(503).json({ ok: false, error: `Não foi possível aplicar o cargo Season Tester: ${role.reason}.` });
  try {
    await db.execute(sql`INSERT INTO season_registrations (season_number,discord_id,discord_name,steam_id,mode,status,accepted_rules_at,updated_at) VALUES (${season},${session.userId},${session.username},${steamId},'beta_free','active',now(),now()) ON CONFLICT (season_number,discord_id) DO UPDATE SET discord_name=EXCLUDED.discord_name,steam_id=EXCLUDED.steam_id,status='active',accepted_rules_at=now(),updated_at=now()`);
    return void res.json({ ok: true, registered: true, discord_id: session.userId, steam_id: steamId, role_applied: true, message: "Inscrição concluída: Discord e Steam confirmados, e cargo Season Tester aplicado." });
  } catch (error) {
    logger.error({ error }, "discord + steam season signup failed");
    return void res.status(500).json({ ok: false, error: "Falha ao concluir a inscrição." });
  }
});

export default router;

import { Router, type IRouter } from "express";
import { getCommunitySession } from "../admin/communitySession.js";
import { getLinkedSteamV2, saveLinkedSteamV2 } from "../bot/utils/linkedSteamV2.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();
const BASE_URL = "https://www.guerrafriarust.com.br";
const STEAM_OPENID = "https://steamcommunity.com/openid/login";
const OFFICIAL_PATH = "/api/season/1/inscricao-oficial";
const STEAM_LOGIN_PATH = "/api/season/1/steam-oficial/login";
const STEAM_CALLBACK_URL = `${BASE_URL}/api/season/1/steam-oficial/callback`;

const esc = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, c => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[c] || c));

function page(username: string, discordId: string, error = "") {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#080a0d"><title>Vincular contas • Season 1</title><style>
*{box-sizing:border-box}html,body{margin:0;min-height:100%;background:#080a0d;color:#f8fafc;font-family:Inter,system-ui,-apple-system,sans-serif}body{background:radial-gradient(circle at 50% -10%,#451215,#120d11 30%,#080a0d 66%)}.w{width:min(760px,calc(100% - 24px));margin:auto;padding:22px 0 80px}.back{display:inline-flex;color:#b5bdc7;text-decoration:none;border:1px solid #303741;background:#11161c;border-radius:12px;padding:11px 14px;font-size:11px;font-weight:900}.hero{padding:34px 0 18px}.ey{font-size:9px;color:#fca5a5;font-weight:1000;letter-spacing:.17em}.hero h1{font-size:clamp(40px,9vw,68px);line-height:.94;letter-spacing:-.055em;margin:9px 0 12px}.hero p{color:#aab2bd;line-height:1.65;font-size:13px}.notice{border:1px solid #3b4a59;background:#101820;color:#c8d5e2;border-radius:16px;padding:15px;font-size:12px;line-height:1.6;margin-bottom:12px}.error{border-color:#7f1d1d;background:#260d10;color:#fecaca}.card{border:1px solid #303741;background:linear-gradient(180deg,#11161c,#0b0f13);border-radius:22px;padding:18px}.steps{display:grid;gap:10px}.step{display:grid;grid-template-columns:48px 1fr;gap:12px;align-items:center;border:1px solid #303741;background:#0b0f14;border-radius:15px;padding:14px}.ico{width:48px;height:48px;display:grid;place-items:center;border-radius:13px;background:#151a20;font-size:23px}.ico img{width:29px;height:29px}.step b{display:block;font-size:14px}.step small{display:block;color:#909aa7;font-size:11px;line-height:1.45;margin-top:4px}.ok{color:#86efac}.pending{color:#fbbf24}.locked{color:#94a3b8}.steamBtn{grid-column:1/-1;display:flex;align-items:center;justify-content:center;text-decoration:none;border:1px solid #66c0f4;background:linear-gradient(135deg,#1b2838,#2a475e);color:#fff;border-radius:12px;padding:14px;font-size:12px;font-weight:1000}.rules{display:flex;justify-content:center;text-decoration:none;color:#d6dbe2;border:1px solid #39414b;background:#151a20;border-radius:12px;padding:13px;margin-top:11px;font-size:11px;font-weight:900}.foot{color:#8e97a3;font-size:10px;line-height:1.6;margin-top:14px;text-align:center}@media(max-width:620px){.hero{padding-top:26px}.card{padding:14px}}
</style></head><body><main class="w"><a class="back" href="/season1">← VOLTAR PARA A SEASON</a><section class="hero"><div class="ey">🏆 SEASON 1 • INSCRIÇÃO OFICIAL</div><h1>Discord + Steam.</h1><p>Antes de escolher entre a inscrição <b>gratuita</b> ou <b>premiada</b>, confirme as contas que serão usadas na Season. Depois da Steam vinculada, você volta automaticamente para escolher a modalidade e, se quiser a premiada, fazer o pagamento.</p></section>${error ? `<div class="notice error"><b>Não foi possível vincular a Steam.</b><br>${esc(error)}</div>` : `<div class="notice"><b>Um único fluxo:</b> Discord → Steam → modalidade → dados → pagamento (somente na premiada) → inscrição concluída.</div>`}<section class="card"><div class="steps"><div class="step"><div class="ico"><img src="https://cdn.simpleicons.org/discord/5865F2" alt="Discord"></div><div><b>1. Discord <span class="ok">✓ conectado</span></b><small>${esc(username)} • ID ${esc(discordId)}</small></div></div><div class="step"><div class="ico"><img src="https://cdn.simpleicons.org/steam/FFFFFF" alt="Steam"></div><div><b>2. Steam <span class="pending">• precisa vincular</span></b><small>Entre pela página oficial da Steam. O SteamID confirmado ficará ligado ao seu Discord para a Season.</small></div><a class="steamBtn" href="${STEAM_LOGIN_PATH}">ENTRAR COM STEAM</a></div><div class="step"><div class="ico">🏆</div><div><b>3. Modalidade e inscrição <span class="locked">• bloqueada</span></b><small>Depois de vincular a Steam, escolha Gratuita (R$ 0) ou Premiada (R$ 20). Na Premiada, o pagamento será feito na própria página.</small></div></div></div><a class="rules" href="/api/season/1/regras">📜 LER REGULAMENTO COMPLETO</a><div class="foot">Inscrições da Season 1 até 20/09/2026 às 23:59.</div></section></main></body></html>`;
}

router.get("/season/1/inscricao-oficial", async (req, res, next) => {
  const session = getCommunitySession(req);
  if (!session) return void res.redirect("/api/admin/auth/login?target=season");
  try {
    const linked = await getLinkedSteamV2(session.userId);
    if (linked?.steamId) return next();
    res.setHeader("Cache-Control", "no-store");
    return void res.status(200).type("html").send(page(session.username, session.userId));
  } catch (error) {
    logger.error({ error }, "official season account gate failed");
    return next(error);
  }
});

router.get("/season/1/steam-oficial/login", (req, res) => {
  const session = getCommunitySession(req);
  if (!session) return void res.redirect("/api/admin/auth/login?target=season");
  const q = new URLSearchParams({
    "openid.ns": "http://specs.openid.net/auth/2.0",
    "openid.mode": "checkid_setup",
    "openid.return_to": STEAM_CALLBACK_URL,
    "openid.realm": BASE_URL,
    "openid.identity": "http://specs.openid.net/auth/2.0/identifier_select",
    "openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select"
  });
  return void res.redirect(`${STEAM_OPENID}?${q.toString()}`);
});

router.get("/season/1/steam-oficial/callback", async (req, res) => {
  const session = getCommunitySession(req);
  if (!session) return void res.redirect("/api/admin/auth/login?target=season");
  try {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(req.query)) {
      if (key.startsWith("openid.") && typeof value === "string") params.set(key, value);
    }
    params.set("openid.mode", "check_authentication");
    const verify = await fetch(STEAM_OPENID, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params
    });
    const text = await verify.text();
    if (!verify.ok || !/is_valid\s*:\s*true/i.test(text)) throw new Error("A Steam não confirmou a autenticação.");

    const claimed = typeof req.query["openid.claimed_id"] === "string" ? String(req.query["openid.claimed_id"]) : "";
    const match = claimed.match(/^https?:\/\/steamcommunity\.com\/openid\/id\/(7656119\d{10})\/?$/i);
    if (!match) throw new Error("SteamID inválido retornado pela Steam.");

    const saved = await saveLinkedSteamV2(session.userId, match[1]);
    if (!saved.ok) {
      if (saved.reason === "steam-linked") throw new Error("Esta Steam já está vinculada a outra conta do Discord. Abra um ticket com a administração.");
      throw new Error("Seu Discord já possui outra Steam vinculada. Por segurança, abra um ticket para alterar a conta.");
    }

    return void res.redirect(`${OFFICIAL_PATH}?steam=ok`);
  } catch (error) {
    logger.error({ error }, "official season Steam OpenID callback failed");
    const message = error instanceof Error ? error.message : "Não foi possível confirmar sua Steam.";
    res.setHeader("Cache-Control", "no-store");
    return void res.status(401).type("html").send(page(session.username, session.userId, message));
  }
});

export default router;

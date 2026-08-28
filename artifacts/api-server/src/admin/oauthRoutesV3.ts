import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { exchangeDiscordCode } from "./discordOAuth.js";
import { fetchDiscordUser } from "./discordUser.js";
import { getGuerraFriaDisplayName, isGuerraFriaAdmin } from "./permissions.js";
import { issueAdminSessionV3, revokeAdminSessionV3 } from "./sessionBearer.js";
import { issueCommunitySession, revokeCommunitySession } from "./communitySession.js";

type Target = "admin" | "community" | "home" | "leaderboard" | "store" | "season";
type LoginState = { expires: number; target: Target; pwaDevice?: string };
type PwaGrant = { token: string; expires: number };

const states = new Map<string, LoginState>();
const pwaGrants = new Map<string, PwaGrant>();
const redirectUri = () => process.env.DISCORD_OAUTH_REDIRECT_URI?.trim() || "https://www.guerrafriarust.com.br/api/admin/auth/callback";
const PWA_GRANT_MS = 10 * 60 * 1000;

function validPwaDevice(value: unknown): string | undefined {
  const device = typeof value === "string" ? value.trim() : "";
  return /^[A-Za-z0-9_-]{16,128}$/.test(device) ? device : undefined;
}

function cleanupPwaGrants(): void {
  const now = Date.now();
  for (const [device, grant] of pwaGrants) if (grant.expires <= now) pwaGrants.delete(device);
}

export function consumePwaAdminGrant(deviceValue: unknown): string | null {
  cleanupPwaGrants();
  const device = validPwaDevice(deviceValue);
  if (!device) return null;
  const grant = pwaGrants.get(device);
  if (!grant || grant.expires <= Date.now()) {
    pwaGrants.delete(device);
    return null;
  }
  pwaGrants.delete(device);
  return grant.token;
}

export function adminLoginV3(req: Request, res: Response): void {
  const clientId = process.env.DISCORD_CLIENT_ID?.trim();
  if (!clientId) return void res.status(500).send("DISCORD_CLIENT_ID não configurado.");

  const raw = String(req.query.target || "");
  const target: Target = raw === "community" ? "community" : raw === "home" ? "home" : raw === "leaderboard" ? "leaderboard" : raw === "store" ? "store" : raw === "season" ? "season" : "admin";
  const state = randomUUID();
  const pwaDevice = validPwaDevice(req.query.device);
  states.set(state, { expires: Date.now() + 10 * 60 * 1000, target, pwaDevice });

  res.setHeader("Cache-Control", "no-store");
  const q = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri(),
    scope: "identify",
    state,
  });
  res.redirect(`https://discord.com/oauth2/authorize?${q.toString()}`);
}

export async function adminCallbackV3(req: Request, res: Response): Promise<void> {
  res.setHeader("Cache-Control", "no-store");

  const code = typeof req.query.code === "string" ? req.query.code : "";
  const state = typeof req.query.state === "string" ? req.query.state : "";
  const stored = states.get(state);
  states.delete(state);

  if (!code || !stored || stored.expires < Date.now()) {
    return void res.status(400).send("Login expirado. Tente novamente.");
  }

  const token = await exchangeDiscordCode(code, redirectUri());
  if (!token?.access_token) return void res.status(401).send("Falha ao autenticar com o Discord.");

  const user = await fetchDiscordUser(token.access_token);
  if (!user) return void res.status(401).send("Não foi possível identificar sua conta.");

  const isAdmin = await isGuerraFriaAdmin(user.id);
  const displayName = await getGuerraFriaDisplayName(user.id, user.global_name || user.username);

  issueCommunitySession(res, user.id, displayName, isAdmin);
  const adminToken = isAdmin ? issueAdminSessionV3(res, user.id, displayName) : null;

  if (stored.target === "admin") {
    if (!isAdmin || !adminToken) return void res.status(403).send("Acesso negado. Sua conta não possui permissão administrativa no Guerra Fria.");

    if (stored.pwaDevice) {
      cleanupPwaGrants();
      pwaGrants.set(stored.pwaDevice, { token: adminToken, expires: Date.now() + PWA_GRANT_MS });
      return void res.status(200).type("html").send(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#07050b"><title>Guerra Fria Admin</title><style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#07050b;color:#fff;font-family:Inter,system-ui,-apple-system,sans-serif;padding:22px}.box{width:min(520px,100%);border:1px solid #3f3150;border-radius:22px;padding:28px;background:#100c16;text-align:center;box-shadow:0 24px 80px #0009}.ok{font-size:54px}.box h1{margin:10px 0 8px}.box p{color:#b6adbf;line-height:1.55}.hint{margin-top:18px;padding:12px;border-radius:12px;background:#0c2818;color:#86efac;font-weight:800}</style></head><body><main class="box"><div class="ok">✅</div><h1>Autenticação concluída</h1><p>Sua conta administrativa foi validada. O aplicativo Guerra Fria Admin já pode concluir o login com segurança.</p><div class="hint">Volte agora para o aplicativo Guerra Fria Admin.</div></main></body></html>`);
    }

    return void res.redirect(`/painel?auth=${encodeURIComponent(adminToken)}`);
  }

  if (stored.target === "community") return void res.redirect("/integridade");
  if (stored.target === "leaderboard") return void res.redirect("/leaderboard");
  if (stored.target === "store") return void res.redirect("/loja");
  if (stored.target === "season") return void res.redirect("/api/season/1/inscricao");
  return void res.redirect("/");
}

export function adminLogoutV3(_req: Request, res: Response): void {
  revokeAdminSessionV3(res);
  revokeCommunitySession(res);
  res.setHeader("Cache-Control", "no-store");
  res.redirect("/");
}

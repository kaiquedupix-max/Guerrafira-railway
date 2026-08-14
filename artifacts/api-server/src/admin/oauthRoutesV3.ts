import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { exchangeDiscordCode } from "./discordOAuth.js";
import { fetchDiscordUser } from "./discordUser.js";
import { getGuerraFriaDisplayName, isGuerraFriaAdmin } from "./permissions.js";
import { issueAdminSessionV3, revokeAdminSessionV3 } from "./sessionBearer.js";
import { issueCommunitySession, revokeCommunitySession } from "./communitySession.js";

type Target = "admin" | "community" | "home" | "leaderboard";
const states = new Map<string, { expires: number; target: Target }>();
const redirectUri = () => process.env.DISCORD_OAUTH_REDIRECT_URI?.trim() || "https://guerrafria.up.railway.app/api/admin/auth/callback";

export function adminLoginV3(req: Request, res: Response): void {
  const clientId = process.env.DISCORD_CLIENT_ID?.trim();
  if (!clientId) return void res.status(500).send("DISCORD_CLIENT_ID não configurado.");
  const raw = String(req.query.target || "");
  const target: Target = raw === "community" ? "community" : raw === "home" ? "home" : raw === "leaderboard" ? "leaderboard" : "admin";
  const state = randomUUID();
  states.set(state, { expires: Date.now() + 10 * 60 * 1000, target });
  const q = new URLSearchParams({ client_id: clientId, response_type: "code", redirect_uri: redirectUri(), scope: "identify", state });
  res.redirect(`https://discord.com/oauth2/authorize?${q.toString()}`);
}

export async function adminCallbackV3(req: Request, res: Response): Promise<void> {
  const code = typeof req.query.code === "string" ? req.query.code : "";
  const state = typeof req.query.state === "string" ? req.query.state : "";
  const stored = states.get(state);
  states.delete(state);
  if (!code || !stored || stored.expires < Date.now()) return void res.status(400).send("Login expirado. Tente novamente.");

  const token = await exchangeDiscordCode(code, redirectUri());
  if (!token?.access_token) return void res.status(401).send("Falha ao autenticar com o Discord.");
  const user = await fetchDiscordUser(token.access_token);
  if (!user) return void res.status(401).send("Não foi possível identificar sua conta.");

  const isAdmin = await isGuerraFriaAdmin(user.id);
  const displayName = await getGuerraFriaDisplayName(user.id, user.global_name || user.username);

  // A sessão pública é sempre criada. Se a conta também for administradora,
  // criamos a sessão administrativa no mesmo login para evitar pedir Discord
  // novamente ao navegar do portal para a Central de Controle.
  issueCommunitySession(res, user.id, displayName, isAdmin);
  const adminToken = isAdmin ? issueAdminSessionV3(res, user.id, displayName) : null;

  if (stored.target === "admin") {
    if (!isAdmin || !adminToken) return void res.status(403).send("Acesso negado. Sua conta não possui permissão administrativa no Guerra Fria.");
    return void res.redirect(`/admin?auth=${encodeURIComponent(adminToken)}`);
  }

  const destination = stored.target === "community" ? "/comunidade" : stored.target === "leaderboard" ? "/leaderboard" : "/";
  return void res.redirect(destination);
}

export function adminLogoutV3(_req: Request, res: Response): void {
  revokeAdminSessionV3(res);
  revokeCommunitySession(res);
  res.redirect("/");
}

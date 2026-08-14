import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { exchangeDiscordCode } from "./discordOAuth.js";
import { fetchDiscordUser } from "./discordUser.js";
import { isGuerraFriaAdmin } from "./permissions.js";
import { issueAdminSessionV3, revokeAdminSessionV3 } from "./sessionBearer.js";
import { issueCommunitySession, revokeCommunitySession } from "./communitySession.js";

const states = new Map<string, { expires: number; target: "admin" | "community" }>();
const redirectUri = () => process.env.DISCORD_OAUTH_REDIRECT_URI?.trim() || "https://guerrafria.up.railway.app/api/admin/auth/callback";

export function adminLoginV3(req: Request, res: Response): void {
  const clientId = process.env.DISCORD_CLIENT_ID?.trim();
  if (!clientId) return void res.status(500).send("DISCORD_CLIENT_ID não configurado.");
  const target = req.query.target === "community" ? "community" : "admin";
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

  if (stored.target === "community") {
    issueCommunitySession(res, user.id, user.global_name || user.username, isAdmin);
    return void res.redirect("/comunidade");
  }

  if (!isAdmin) return void res.status(403).send("Acesso negado. Sua conta não é administradora do Guerra Fria.");
  const sessionToken = issueAdminSessionV3(res, user.id, user.global_name || user.username);
  res.redirect(`/admin?auth=${encodeURIComponent(sessionToken)}`);
}

export function adminLogoutV3(_req: Request, res: Response): void {
  revokeAdminSessionV3(res);
  revokeCommunitySession(res);
  res.redirect("/?admin_logout=1");
}

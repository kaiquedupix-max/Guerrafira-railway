import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { exchangeDiscordCode } from "./discordOAuth.js";
import { fetchDiscordUser } from "./discordUser.js";
import { getGuerraFriaDisplayName, isGuerraFriaAdmin } from "./permissions.js";
import { issueAdminSessionV3, revokeAdminSessionV3 } from "./sessionBearer.js";
import { issueCommunitySession, revokeCommunitySession } from "./communitySession.js";

type Target = "admin" | "community" | "home" | "leaderboard" | "store" | "season";
const states = new Map<string, { expires: number; target: Target }>();
const redirectUri = () => process.env.DISCORD_OAUTH_REDIRECT_URI?.trim() || "https://www.guerrafriarust.com.br/api/admin/auth/callback";

export function adminLoginV3(req: Request, res: Response): void {
  const clientId = process.env.DISCORD_CLIENT_ID?.trim();
  if (!clientId) return void res.status(500).send("DISCORD_CLIENT_ID não configurado.");

  const raw = String(req.query.target || "");
  const target: Target = raw === "community" ? "community" : raw === "home" ? "home" : raw === "leaderboard" ? "leaderboard" : raw === "store" ? "store" : raw === "season" ? "season" : "admin";
  const state = randomUUID();
  states.set(state, { expires: Date.now() + 10 * 60 * 1000, target });

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
  if (isAdmin) issueAdminSessionV3(res, user.id, displayName);

  if (stored.target === "admin") {
    if (!isAdmin) return void res.status(403).send("Acesso negado. Sua conta não possui permissão administrativa no Guerra Fria.");
    return void res.redirect("/painel");
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

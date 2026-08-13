import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { exchangeDiscordCode } from "./discordOAuth.js";
import { fetchDiscordUser } from "./discordUser.js";
import { isGuerraFriaAdmin } from "./permissions.js";
import { issueAdminSession, revokeAdminSession } from "./session.js";

const states = new Map<string, number>();
const redirectUri = () => process.env.DISCORD_OAUTH_REDIRECT_URI?.trim() || "https://guerrafria.up.railway.app/api/admin/auth/callback";

export function adminLogin(_req: Request, res: Response): void {
  const clientId = process.env.DISCORD_CLIENT_ID?.trim();
  if (!clientId) return void res.status(500).send("DISCORD_CLIENT_ID não configurado.");
  const state = randomUUID();
  states.set(state, Date.now() + 600000);
  const q = new URLSearchParams({ client_id: clientId, response_type: "code", redirect_uri: redirectUri(), scope: "identify", state });
  res.redirect(`https://discord.com/oauth2/authorize?${q.toString()}`);
}

export async function adminCallback(req: Request, res: Response): Promise<void> {
  const code = typeof req.query.code === "string" ? req.query.code : "";
  const state = typeof req.query.state === "string" ? req.query.state : "";
  const expires = states.get(state) ?? 0;
  states.delete(state);
  if (!code || expires < Date.now()) return void res.status(400).send("Login expirado. Tente novamente.");
  const token = await exchangeDiscordCode(code, redirectUri());
  if (!token?.access_token) return void res.status(401).send("Falha ao autenticar com o Discord.");
  const user = await fetchDiscordUser(token.access_token);
  if (!user) return void res.status(401).send("Não foi possível identificar sua conta.");
  if (!(await isGuerraFriaAdmin(user.id))) return void res.status(403).send("Acesso negado. Sua conta não é administradora do Guerra Fria.");
  issueAdminSession(res, user.id, user.username);
  res.redirect("/admin");
}

export function adminLogout(req: Request, res: Response): void {
  revokeAdminSession(req, res);
  res.redirect("/");
}

import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";

export type AdminSession = { userId: string; username: string; expiresAt: number };

const ADMIN_SESSION_MS = 180 * 24 * 60 * 60 * 1000;

function secret(): string {
  return process.env.ADMIN_SESSION_SECRET?.trim() || process.env.DISCORD_CLIENT_SECRET?.trim() || "guerra-fria-session";
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

function parseToken(token?: string | null): AdminSession | null {
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = sign(payload);
  const a = Buffer.from(signature, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as AdminSession;
    if (!session.userId || !session.username || session.expiresAt < Date.now()) return null;
    return session;
  } catch {
    return null;
  }
}

export function issueAdminSessionV3(res: Response, userId: string, username: string): string {
  const session: AdminSession = { userId, username, expiresAt: Date.now() + ADMIN_SESSION_MS };
  const payload = Buffer.from(JSON.stringify(session), "utf8").toString("base64url");
  const token = `${payload}.${sign(payload)}`;
  res.cookie("gf_admin", token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: ADMIN_SESSION_MS,
  });
  return token;
}

export function getAdminSessionV3(req: Request): AdminSession | null {
  const auth = req.get("authorization") ?? "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  const queryToken = typeof req.query?.auth === "string" ? req.query.auth : "";
  const cookieToken = req.cookies?.gf_admin as string | undefined;
  return parseToken(bearer) || parseToken(queryToken) || parseToken(cookieToken);
}

export function revokeAdminSessionV3(res: Response): void {
  res.clearCookie("gf_admin", { path: "/", secure: true, sameSite: "lax" });
}

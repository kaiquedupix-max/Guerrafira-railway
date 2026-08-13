import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";

export type AdminSession = { userId: string; username: string; expiresAt: number };

function secret(): string {
  return process.env.ADMIN_SESSION_SECRET?.trim() || process.env.DISCORD_CLIENT_SECRET?.trim() || "guerra-fria-session";
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function issueAdminSession(res: Response, userId: string, username: string): void {
  const session: AdminSession = { userId, username, expiresAt: Date.now() + 12 * 60 * 60 * 1000 };
  const payload = Buffer.from(JSON.stringify(session), "utf8").toString("base64url");
  const token = `${payload}.${sign(payload)}`;

  res.cookie("gf_admin", token, {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    path: "/",
    maxAge: 12 * 60 * 60 * 1000,
  });
}

export function getAdminSession(req: Request): AdminSession | null {
  const token = req.cookies?.gf_admin as string | undefined;
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

export function revokeAdminSession(_req: Request, res: Response): void {
  res.clearCookie("gf_admin", { path: "/", secure: true, sameSite: "none" });
}

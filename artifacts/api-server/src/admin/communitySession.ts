import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";

export type CommunitySession = { userId: string; username: string; isAdmin: boolean; exp: number };
const COOKIE = "gf_community";
const MAX_AGE = 12 * 60 * 60 * 1000;
const secret = () => process.env.ADMIN_SESSION_SECRET?.trim() || process.env.DISCORD_CLIENT_SECRET?.trim() || "guerra-fria-community-session";
const b64 = (s: string) => Buffer.from(s).toString("base64url");
const sign = (payload: string) => createHmac("sha256", secret()).update(payload).digest("base64url");

export function issueCommunitySession(res: Response, userId: string, username: string, isAdmin: boolean): void {
  const data: CommunitySession = { userId, username, isAdmin, exp: Date.now() + MAX_AGE };
  const payload = b64(JSON.stringify(data));
  const token = `${payload}.${sign(payload)}`;
  res.cookie(COOKIE, token, { httpOnly: true, secure: true, sameSite: "lax", maxAge: MAX_AGE, path: "/" });
}

export function getCommunitySession(req: Request): CommunitySession | null {
  const token = String(req.cookies?.[COOKIE] ?? "");
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = sign(payload);
  const a = Buffer.from(signature); const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as CommunitySession;
    if (!data.userId || !data.username || data.exp < Date.now()) return null;
    return data;
  } catch { return null; }
}

export function revokeCommunitySession(res: Response): void {
  res.clearCookie(COOKIE, { path: "/", secure: true, sameSite: "lax" });
}

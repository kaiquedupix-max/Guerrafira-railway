import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";

export type AdminSession = { userId: string; username: string; expiresAt: number };
const sessions = new Map<string, AdminSession>();

export function issueAdminSession(res: Response, userId: string, username: string): void {
  const id = randomUUID();
  sessions.set(id, { userId, username, expiresAt: Date.now() + 43200000 });
  res.cookie("gf_admin", id, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 43200000 });
}

export function getAdminSession(req: Request): AdminSession | null {
  const id = req.cookies?.gf_admin as string | undefined;
  if (!id) return null;
  const session = sessions.get(id);
  if (!session || session.expiresAt < Date.now()) {
    sessions.delete(id);
    return null;
  }
  return session;
}

export function revokeAdminSession(req: Request, res: Response): void {
  const id = req.cookies?.gf_admin as string | undefined;
  if (id) sessions.delete(id);
  res.clearCookie("gf_admin");
}

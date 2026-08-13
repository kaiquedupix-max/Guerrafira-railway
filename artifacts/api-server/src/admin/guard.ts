import type { NextFunction, Request, Response } from "express";
import { getAdminSession } from "./sessionCookie.js";
import { isGuerraFriaAdmin } from "./permissions.js";

export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const session = getAdminSession(req);
  if (!session) return res.status(401).json({ error: "not_authenticated" });
  if (!(await isGuerraFriaAdmin(session.userId))) return res.status(403).json({ error: "not_authorized" });
  res.locals.admin = session;
  next();
}

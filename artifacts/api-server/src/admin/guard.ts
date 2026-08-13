import type { NextFunction, Request, Response } from "express";
import { getAdminSession } from "./sessionCookie.js";

export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const session = getAdminSession(req);
  if (!session) return res.status(401).json({ error: "not_authenticated" });
  res.locals.admin = session;
  next();
}

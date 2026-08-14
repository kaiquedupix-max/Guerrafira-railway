import type { NextFunction, Request, Response } from "express";
import { getAdminSessionV3 } from "./sessionBearer.js";

export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const session = getAdminSessionV3(req);
  if (!session) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    return res.status(401).json({ error: "not_authenticated" });
  }
  res.locals.admin = session;
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  next();
}

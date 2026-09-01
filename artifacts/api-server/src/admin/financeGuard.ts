import type { Request, Response, NextFunction } from "express";
import { getAdminSessionV3 } from "./sessionBearer.js";
import { isGuerraFriaCEO } from "./permissions.js";

export async function requireFinanceAccess(req: Request, res: Response, next: NextFunction) {
  const session = getAdminSessionV3(req);
  if (!session) return void res.status(401).json({ error: "Sessão administrativa inválida." });
  if (!(await isGuerraFriaCEO(session.userId))) {
    return void res.status(403).json({ error: "Você não tem permissão para ver esses dados." });
  }
  next();
}

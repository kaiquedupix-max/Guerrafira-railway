import type { Request, Response, NextFunction } from "express";

/**
 * Keeps the Season profile rank labels aligned with the public ranking.
 * A registered player with 0 XP starts as Soldado, even before their first
 * tracked activity creates a season_players row.
 */
export function seasonProfileRankDisplayFix(req: Request, res: Response, next: NextFunction) {
  if (req.method !== "GET" || req.path !== "/season/1/inscricao-oficial") return next();

  const originalSend = res.send.bind(res);
  res.send = ((body?: any) => {
    if (typeof body === "string") {
      body = body
        .replace('alt="Recruta"', 'alt="Soldado"')
        .replace('PATENTE ATUAL • [REC]', 'PATENTE ATUAL • [SLD]')
        .replace('<h3>Recruta</h3>', '<h3>Soldado</h3>')
        .replace(
          'Jogue uma atividade válida para sair de Recruta e entrar no ranking.',
          'Jogue uma atividade válida para entrar no ranking e começar sua progressão como Soldado.'
        );
    }
    return originalSend(body);
  }) as Response["send"];

  next();
}

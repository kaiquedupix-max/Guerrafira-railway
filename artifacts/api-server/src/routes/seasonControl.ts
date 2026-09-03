import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

export async function ensureSeasonControl() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS season_control (
      season_number INTEGER PRIMARY KEY,
      scoring_blocked BOOLEAN NOT NULL DEFAULT FALSE,
      changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      changed_by TEXT,
      last_reset_at TIMESTAMPTZ,
      last_reset_by TEXT
    )
  `);
  await db.execute(sql`
    INSERT INTO season_control (season_number, scoring_blocked)
    VALUES (1, FALSE)
    ON CONFLICT (season_number) DO NOTHING
  `);
}

export async function getSeasonControl(seasonNumber = 1) {
  await ensureSeasonControl();
  const r: any = await db.execute(sql`
    SELECT season_number, scoring_blocked, changed_at, changed_by, last_reset_at, last_reset_by
    FROM season_control WHERE season_number=${seasonNumber} LIMIT 1
  `);
  return r?.rows?.[0] ?? { season_number: seasonNumber, scoring_blocked: false };
}

export async function setSeasonScoringBlocked(seasonNumber: number, blocked: boolean, admin: string) {
  await ensureSeasonControl();
  await db.execute(sql`
    INSERT INTO season_control (season_number, scoring_blocked, changed_at, changed_by)
    VALUES (${seasonNumber}, ${blocked}, now(), ${admin})
    ON CONFLICT (season_number) DO UPDATE SET
      scoring_blocked=EXCLUDED.scoring_blocked,
      changed_at=now(), changed_by=EXCLUDED.changed_by
  `);
}

export async function markSeasonReset(seasonNumber: number, admin: string) {
  await ensureSeasonControl();
  await db.execute(sql`
    UPDATE season_control SET last_reset_at=now(), last_reset_by=${admin}, changed_at=now(), changed_by=${admin}
    WHERE season_number=${seasonNumber}
  `);
}

const router: IRouter = Router();
router.use(async (req, res, next) => {
  const scoringWritePaths = new Set([
    "/season/events",
    "/season/snapshot",
    "/season/snapshot-fast",
  ]);
  if (!scoringWritePaths.has(req.path)) return next();
  try {
    const control = await getSeasonControl(1);
    if (Boolean(control.scoring_blocked)) {
      res.setHeader("Cache-Control", "no-store");
      return void res.status(202).json({
        ok: true,
        blocked: true,
        accepted: 0,
        saved: 0,
        message: "Pontuação da Season 1 está bloqueada pela administração."
      });
    }
    return next();
  } catch {
    return void res.status(503).json({ ok: false, error: "Não foi possível validar o estado da pontuação da Season 1." });
  }
});

export default router;

import { Router, type IRouter, type Request } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { getCommunitySession } from "../admin/communitySession.js";
import { getAdminSessionV3 } from "../admin/sessionBearer.js";

const router: IRouter = Router();
const SEASON_1_START_AT = Date.parse("2026-09-03T00:00:00-03:00");

function num(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function int(value: unknown, fallback = 0): number {
  return Math.trunc(num(value, fallback));
}

function text(value: unknown, max = 64): string {
  return String(value ?? "").slice(0, max);
}

function canReadSeason(req: Request, seasonNumber: number): boolean {
  if (seasonNumber !== 1 || Date.now() >= SEASON_1_START_AT) return true;
  return Boolean(getCommunitySession(req)?.isAdmin || getAdminSessionV3(req));
}

router.get("/season/:number/player/:steamId/audit", async (req, res) => {
  try {
    const seasonNumber = Math.max(1, int(req.params.number, 1));
    if (!canReadSeason(req, seasonNumber)) return void res.status(403).json({ error: "Em breve" });
    const steamId = text(req.params.steamId, 32);
    const limit = Math.min(200, Math.max(25, int(req.query.limit, 100)));
    const offset = Math.max(0, int(req.query.offset, 0));

    if (!/^7656119\d{10}$/.test(steamId) && steamId !== "0") {
      return void res.status(400).json({ error: "SteamID inválido." });
    }

    const playerResult: any = await db.execute(sql`
      SELECT *
      FROM season_players
      WHERE season_number=${seasonNumber} AND steam_id=${steamId}
      LIMIT 1
    `);

    const player = playerResult?.rows?.[0] ?? null;
    if (!player) return void res.status(404).json({ error: "Jogador não encontrado nesta Season." });

    const summaryResult: any = await db.execute(sql`
      SELECT
        category,
        COUNT(*)::int AS entries,
        COALESCE(SUM(CASE WHEN final_value > 0 THEN final_value ELSE 0 END),0) AS gains,
        COALESCE(SUM(CASE WHEN final_value < 0 THEN final_value ELSE 0 END),0) AS losses,
        COALESCE(SUM(final_value),0) AS net
      FROM season_transactions
      WHERE season_number=${seasonNumber} AND steam_id=${steamId}
      GROUP BY category
      ORDER BY net DESC
    `);

    const totalResult: any = await db.execute(sql`
      SELECT COUNT(*)::int AS total
      FROM season_transactions
      WHERE season_number=${seasonNumber} AND steam_id=${steamId}
    `);

    const txResult: any = await db.execute(sql`
      SELECT
        transaction_id,
        category,
        event_type,
        base_value,
        multiplier,
        final_value,
        resulting_mmr,
        details,
        happened_at
      FROM season_transactions
      WHERE season_number=${seasonNumber} AND steam_id=${steamId}
      ORDER BY happened_at DESC, received_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `);

    const total = Number(totalResult?.rows?.[0]?.total || 0);

    res.setHeader("Cache-Control", "public, max-age=5, stale-while-revalidate=10");
    return void res.json({
      ok: true,
      season_number: seasonNumber,
      player,
      summary: summaryResult?.rows ?? [],
      transactions: txResult?.rows ?? [],
      pagination: {
        limit,
        offset,
        total,
        has_more: offset + limit < total,
      },
    });
  } catch (error) {
    logger.error({ error }, "season public audit read failed");
    return void res.status(500).json({ error: "Falha ao carregar auditoria pública da Season." });
  }
});

export default router;

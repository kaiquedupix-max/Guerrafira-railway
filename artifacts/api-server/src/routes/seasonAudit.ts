import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();
const GENERAL_THRESHOLD = 1700;

function num(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function int(value: unknown, fallback = 0): number { return Math.trunc(num(value, fallback)); }
function text(value: unknown, max = 64): string { return String(value ?? "").slice(0, max); }

function rankName(mmr: unknown): string {
  const v = num(mmr, 1000);
  if (v >= GENERAL_THRESHOLD) return "General de Guerra";
  if (v >= 1450) return "Coronel";
  if (v >= 1250) return "Capitão";
  if (v >= 1100) return "Soldado";
  return "Recruta";
}

router.get("/season/:number/player/:steamId/audit", async (req, res) => {
  try {
    const seasonNumber = Math.max(1, int(req.params.number, 1));
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
    const row = playerResult?.rows?.[0] ?? null;
    if (!row) return void res.status(404).json({ error: "Jogador não encontrado nesta Season." });

    const patente = rankName(row.mmr);
    const player: Record<string, any> = {
      steam_id: row.steam_id,
      player_name: row.player_name,
      patente,
      patente_maxima: patente === "General de Guerra",
      kills: int(row.kills),
      deaths: int(row.deaths),
      headshots: int(row.headshots),
      assists: int(row.assists),
      raids_participated: int(row.raids_participated),
      raids_defended: int(row.raids_defended),
      bradley_participations: int(row.bradley_participations),
      heli_participations: int(row.heli_participations),
      crates_hacked: int(row.crates_hacked),
      updated_at: row.updated_at,
    };
    if (player.patente_maxima) player.general_score = Math.round(num(row.mmr) * 100) / 100;

    const summaryResult: any = await db.execute(sql`
      SELECT
        category,
        COUNT(*)::int AS entries,
        COUNT(*) FILTER (WHERE final_value > 0)::int AS gains,
        COUNT(*) FILTER (WHERE final_value < 0)::int AS losses
      FROM season_transactions
      WHERE season_number=${seasonNumber} AND steam_id=${steamId}
      GROUP BY category
      ORDER BY entries DESC
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
        CASE WHEN final_value > 0 THEN 'gain' WHEN final_value < 0 THEN 'loss' ELSE 'neutral' END AS direction,
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
      disclosure: "Os valores individuais de MMR e o valor de cada ação não são públicos. A auditoria mostra quais ações contaram e se geraram ganho ou perda.",
      pagination: { limit, offset, total, has_more: offset + limit < total },
    });
  } catch (error) {
    logger.error({ error }, "season public audit read failed");
    return void res.status(500).json({ error: "Falha ao carregar auditoria pública da Season." });
  }
});

export default router;

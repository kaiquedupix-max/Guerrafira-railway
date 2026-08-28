import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAdmin } from "./guard.js";

const router = Router();
router.use(requireAdmin);

async function ensureRegistrationTable() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS season_registrations (
      season_number INTEGER NOT NULL,
      discord_id TEXT NOT NULL,
      discord_name TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'beta_free',
      status TEXT NOT NULL DEFAULT 'active',
      accepted_rules_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (season_number, discord_id)
    )
  `);
}

function rankName(mmrValue: unknown) {
  const mmr = Number(mmrValue ?? 1000);
  if (mmr >= 1700) return "General de Guerra";
  if (mmr >= 1450) return "Coronel";
  if (mmr >= 1250) return "Capitão";
  if (mmr >= 1100) return "Soldado";
  return "Recruta";
}

router.get("/registrations", async (req, res) => {
  try {
    await ensureRegistrationTable();
    const season = Math.max(1, Math.trunc(Number(req.query.season) || 1));
    const result: any = await db.execute(sql`
      SELECT
        r.season_number,
        r.discord_id,
        r.discord_name,
        r.mode,
        r.status,
        r.accepted_rules_at,
        r.created_at,
        b.steam_id,
        p.player_name,
        p.mmr,
        p.kills,
        p.deaths,
        p.headshots,
        p.raids_participated,
        p.raids_defended,
        p.bradley_participations,
        p.heli_participations,
        p.crates_hacked,
        p.updated_at
      FROM season_registrations r
      LEFT JOIN booster_links b ON b.discord_user_id = r.discord_id
      LEFT JOIN season_players p ON p.season_number = r.season_number AND p.steam_id = b.steam_id
      WHERE r.season_number = ${season} AND r.status = 'active'
      ORDER BY p.mmr DESC NULLS LAST, r.created_at ASC
    `);

    const rows = Array.isArray(result?.rows) ? result.rows : [];
    const registrations = rows.map((row: any, index: number) => ({
      position: row.mmr == null ? null : index + 1,
      discordId: String(row.discord_id || ""),
      discordName: String(row.discord_name || ""),
      steamId: row.steam_id ? String(row.steam_id) : null,
      playerName: row.player_name ? String(row.player_name) : null,
      mode: String(row.mode || "beta_free"),
      status: String(row.status || "active"),
      acceptedRulesAt: row.accepted_rules_at,
      createdAt: row.created_at,
      mmr: row.mmr == null ? null : Number(row.mmr),
      rank: row.mmr == null ? "Aguardando dados" : rankName(row.mmr),
      kills: Number(row.kills || 0),
      deaths: Number(row.deaths || 0),
      headshots: Number(row.headshots || 0),
      raids: Number(row.raids_participated || 0) + Number(row.raids_defended || 0),
      events: Number(row.bradley_participations || 0) + Number(row.heli_participations || 0) + Number(row.crates_hacked || 0),
      updatedAt: row.updated_at,
      testerRole: true,
    }));

    const ranked = registrations.filter((row: any) => row.mmr != null);
    res.setHeader("Cache-Control", "no-store");
    return void res.json({
      ok: true,
      beta: season === 1,
      season,
      roleId: process.env.SEASON_BETA_ROLE_ID || null,
      summary: {
        total: registrations.length,
        linkedSteam: registrations.filter((row: any) => row.steamId).length,
        withSeasonData: ranked.length,
        leader: ranked[0] || null,
      },
      registrations,
    });
  } catch (error) {
    req.log?.error?.({ error }, "admin season registrations failed");
    return void res.status(500).json({ error: "Falha ao carregar inscritos da Season." });
  }
});

export default router;

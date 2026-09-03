import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAdmin } from "./guard.js";
import { SEASON_OFFICIAL_KEY } from "../routes/seasonEmailService.js";

const router = Router();
router.use(requireAdmin);

function rankName(mmrValue: unknown, position = 0) {
  const mmr = Number(mmrValue ?? 1000);
  const xp = Math.max(0, Math.round((mmr - 1000) * 9));
  if (position === 1 && xp >= 1800) return "General Frio";
  if (xp >= 1800) return "Marechal";
  if (xp >= 1200) return "Major";
  if (xp >= 600) return "Tenente";
  return "Soldado";
}

async function ensureOfficialTable() {
  await db.execute(sql`CREATE TABLE IF NOT EXISTS season_official_registrations (
    season_key INTEGER NOT NULL,
    discord_id TEXT NOT NULL,
    discord_name TEXT NOT NULL,
    steam_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    amount NUMERIC(10,2) NOT NULL DEFAULT 20,
    mp_payment_id TEXT,
    mp_preference_id TEXT,
    full_name TEXT,
    contact_email TEXT,
    prize_pix_type TEXT,
    prize_pix_key TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    paid_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY(season_key,discord_id)
  )`);
}

async function resolveCurrentScoringSeason(): Promise<number | null> {
  const result: any = await db.execute(sql`
    SELECT p.season_number,
           COUNT(*)::int AS player_count,
           MAX(p.updated_at) AS last_update,
           MAX(s.status) AS status
      FROM season_players p
      LEFT JOIN seasons s ON s.season_number = p.season_number
     GROUP BY p.season_number
     ORDER BY CASE WHEN MAX(s.status) = 'active' THEN 0 ELSE 1 END,
              MAX(p.updated_at) DESC NULLS LAST,
              p.season_number DESC
     LIMIT 1
  `);
  const value = result?.rows?.[0]?.season_number;
  return value == null ? null : Number(value);
}

// IMPORTANT: this endpoint intentionally shadows the legacy /season/registrations
// handler. The administration panel must never mix beta/previous-season signups
// from season_registrations with the current paid/official season.
router.get("/registrations", async (req, res) => {
  try {
    await ensureOfficialTable();
    const sourceSeason = await resolveCurrentScoringSeason();

    const result: any = sourceSeason == null
      ? await db.execute(sql`
          SELECT r.season_key,r.discord_id,r.discord_name,r.steam_id,r.status,r.created_at,
                 NULL::text AS player_name,NULL::numeric AS raw_mmr,NULL::numeric AS mmr,
                 0::numeric AS admin_delta,0::int AS kills,0::int AS deaths,0::int AS headshots,
                 0::int AS raids_participated,0::int AS raids_defended,0::int AS bradley_participations,
                 0::int AS heli_participations,0::int AS crates_hacked,NULL::timestamptz AS updated_at
            FROM season_official_registrations r
           WHERE r.season_key=${SEASON_OFFICIAL_KEY} AND r.status='active'
           ORDER BY r.paid_at ASC NULLS LAST,r.created_at ASC
        `)
      : await db.execute(sql`
          WITH admin_delta AS (
            SELECT steam_id,COALESCE(SUM(final_value),0) AS delta
              FROM season_transactions
             WHERE season_number=${sourceSeason} AND category='admin'
             GROUP BY steam_id
          )
          SELECT r.season_key,r.discord_id,r.discord_name,r.steam_id,r.status,r.created_at,
                 p.player_name,p.mmr AS raw_mmr,
                 CASE WHEN p.mmr IS NULL THEN NULL ELSE p.mmr+COALESCE(a.delta,0) END AS mmr,
                 COALESCE(a.delta,0) AS admin_delta,
                 COALESCE(p.kills,0) AS kills,COALESCE(p.deaths,0) AS deaths,COALESCE(p.headshots,0) AS headshots,
                 COALESCE(p.raids_participated,0) AS raids_participated,COALESCE(p.raids_defended,0) AS raids_defended,
                 COALESCE(p.bradley_participations,0) AS bradley_participations,
                 COALESCE(p.heli_participations,0) AS heli_participations,
                 COALESCE(p.crates_hacked,0) AS crates_hacked,p.updated_at
            FROM season_official_registrations r
            LEFT JOIN season_players p
              ON p.season_number=${sourceSeason} AND p.steam_id=NULLIF(TRIM(r.steam_id),'')
            LEFT JOIN admin_delta a ON a.steam_id=NULLIF(TRIM(r.steam_id),'')
           WHERE r.season_key=${SEASON_OFFICIAL_KEY} AND r.status='active'
           ORDER BY mmr DESC NULLS LAST,r.paid_at ASC NULLS LAST,r.created_at ASC
        `);

    const rows = Array.isArray(result?.rows) ? result.rows : [];
    let position = 0;
    const registrations = rows.map((row: any) => {
      const steamId = row.steam_id ? String(row.steam_id).trim() : null;
      const hasSeasonData = row.mmr != null;
      if (hasSeasonData) position++;
      return {
        position: hasSeasonData ? position : null,
        discordId: String(row.discord_id || ""),
        discordName: String(row.discord_name || ""),
        steamId,
        steamConfirmed: Boolean(steamId),
        steamSource: steamId ? "official_registration" : null,
        hasSeasonData,
        playerName: row.player_name ? String(row.player_name) : null,
        mode: "official",
        status: String(row.status || "active"),
        acceptedRulesAt: row.created_at,
        createdAt: row.created_at,
        mmr: row.mmr == null ? null : Number(row.mmr),
        rawMmr: row.raw_mmr == null ? null : Number(row.raw_mmr),
        adminDelta: Number(row.admin_delta || 0),
        rank: steamId ? (hasSeasonData ? rankName(row.mmr, position) : "Soldado") : "Steam não vinculada",
        kills: Number(row.kills || 0),
        deaths: Number(row.deaths || 0),
        headshots: Number(row.headshots || 0),
        raids: Number(row.raids_participated || 0) + Number(row.raids_defended || 0),
        events: Number(row.bradley_participations || 0) + Number(row.heli_participations || 0) + Number(row.crates_hacked || 0),
        updatedAt: row.updated_at,
        testerRole: false,
      };
    });

    const ranked = registrations.filter((x: any) => x.hasSeasonData);
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    return void res.json({
      ok: true,
      beta: false,
      season: 1,
      seasonKey: SEASON_OFFICIAL_KEY,
      dataSourceSeason: sourceSeason,
      fallbackSource: sourceSeason != null && sourceSeason !== 1,
      roleId: null,
      summary: {
        total: registrations.length,
        linkedSteam: registrations.filter((x: any) => x.steamId).length,
        confirmedSteam: registrations.filter((x: any) => x.steamConfirmed).length,
        withSeasonData: ranked.length,
        leader: ranked[0] || null,
      },
      registrations,
    });
  } catch (error) {
    req.log?.error?.({ error }, "current official season admin registrations failed");
    return void res.status(500).json({ error: "Falha ao carregar inscritos da Season oficial atual." });
  }
});

export default router;

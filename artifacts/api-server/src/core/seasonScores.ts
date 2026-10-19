import { sql } from "drizzle-orm";
import { SEASON_2_START_AT, seasonRegistrationKey } from "../routes/seasonRanks.js";
const STARTING_MMR=1000;
export function seasonStandingsSql(seasonNumber:number){
  const key=seasonRegistrationKey(seasonNumber);

  // Season 2 is read from its own immutable transaction ledger instead of the
  // cumulative player snapshot. The Rust plugin can stay alive across the
  // Season 1 -> Season 2 transition and temporarily hold S1 counters in RAM;
  // using that snapshot here would leak the previous Season into the new one.
  // Every accepted event is already remapped by seasonIngestionSafe to the
  // canonical active Season, so summing S2 transactions from the official
  // start produces the correct fresh S2 score even during that rollover.
  if (seasonNumber === 2) {
    return sql`
      WITH registered AS (
        SELECT DISTINCT ON (steam_id) steam_id,discord_name,created_at
        FROM season_official_registrations
        WHERE season_key=${key} AND status='active' AND NULLIF(TRIM(steam_id),'') IS NOT NULL
        ORDER BY steam_id,created_at ASC
      ),
      ledger AS (
        SELECT
          steam_id,
          (ARRAY_AGG(player_name ORDER BY happened_at DESC))[1] player_name,
          COALESCE(SUM(final_value),0) delta,
          COUNT(*) FILTER (WHERE event_type='KILL')::int kills,
          COUNT(*) FILTER (WHERE event_type='DEATH')::int deaths,
          COUNT(*) FILTER (WHERE event_type='ASSIST')::int assists,
          COUNT(*) FILTER (
            WHERE event_type='KILL' AND (
              LOWER(COALESCE(details,'')) ~ '(^|[ |])hs=true([ |]|$)' OR
              LOWER(COALESCE(details,'')) LIKE '%headshot=true%' OR
              LOWER(COALESCE(details,'')) LIKE '%headshot: true%' OR
              LOWER(COALESCE(details,'')) LIKE '%"headshot":true%' OR LOWER(COALESCE(details,'')) LIKE '%"headshot": true%'
            )
          )::int headshots,
          COUNT(*) FILTER (WHERE event_type='RAID_SESSION_COMPLETE')::int raids_participated,
          COUNT(*) FILTER (WHERE event_type='RAID_DEFENDED')::int raids_defended,
          COUNT(*) FILTER (WHERE event_type ILIKE '%BRADLEY%')::int bradley_participations,
          COUNT(*) FILTER (WHERE event_type ILIKE '%HELI%')::int heli_participations,
          COUNT(*) FILTER (WHERE event_type ILIKE '%CRATE%')::int crates_hacked,
          COALESCE(SUM(CASE WHEN event_type ILIKE '%SULFUR%' THEN GREATEST(base_value,0) ELSE 0 END),0)::bigint sulfur_ore,
          COALESCE(SUM(CASE WHEN event_type ILIKE '%HQM%' THEN GREATEST(base_value,0) ELSE 0 END),0)::bigint hqm_ore,
          MAX(received_at) updated_at
        FROM season_transactions
        WHERE season_number=2
          AND happened_at >= ${new Date(SEASON_2_START_AT)}
        GROUP BY steam_id
      ),
      u AS (
        SELECT
          r.steam_id,
          COALESCE(NULLIF(l.player_name,''),r.discord_name,r.steam_id) player_name,
          ${STARTING_MMR}::double precision mmr,
          COALESCE(l.delta,0)::double precision ledger_delta,
          COALESCE(l.kills,0) kills,
          COALESCE(l.deaths,0) deaths,
          COALESCE(l.headshots,0) headshots,
          COALESCE(l.assists,0) assists,
          COALESCE(l.raids_participated,0) raids_participated,
          COALESCE(l.raids_defended,0) raids_defended,
          COALESCE(l.bradley_participations,0) bradley_participations,
          COALESCE(l.heli_participations,0) heli_participations,
          COALESCE(l.crates_hacked,0) crates_hacked,
          COALESCE(l.sulfur_ore,0) sulfur_ore,
          COALESCE(l.hqm_ore,0) hqm_ore,
          COALESCE(l.updated_at,r.created_at) updated_at,
          (l.steam_id IS NOT NULL) season_scored
        FROM registered r
        LEFT JOIN ledger l ON l.steam_id=r.steam_id
      ),
      ranked AS (
        SELECT
          u.*,
          ${STARTING_MMR}+u.ledger_delta effective_mmr,
          ROW_NUMBER() OVER(
            ORDER BY ${STARTING_MMR}+u.ledger_delta DESC,u.kills DESC,u.updated_at ASC NULLS LAST
          ) position
        FROM u
      )
      SELECT * FROM ranked
    `;
  }

  if (seasonNumber === 1) {
    return sql`
      WITH adjustments AS (
        SELECT steam_id,COALESCE(SUM(final_value),0) delta
        FROM season_transactions
        WHERE season_number=${seasonNumber} AND category='admin'
        GROUP BY steam_id
      ),
      sd AS (
        SELECT * FROM season_players WHERE season_number=${seasonNumber}
      ),
      registered AS (
        SELECT DISTINCT ON (steam_id) steam_id,discord_name,created_at
        FROM season_official_registrations
        WHERE season_key=${key} AND status='active' AND NULLIF(TRIM(steam_id),'') IS NOT NULL
        ORDER BY steam_id,created_at ASC
      ),
      u AS (
        SELECT r.steam_id,
          COALESCE(NULLIF(sd.player_name,''),r.discord_name,r.steam_id) player_name,
          COALESCE(sd.mmr,${STARTING_MMR}) mmr,
          COALESCE(sd.kills,0) kills,COALESCE(sd.deaths,0) deaths,
          COALESCE(sd.headshots,0) headshots,COALESCE(sd.assists,0) assists,
          COALESCE(sd.raids_participated,0) raids_participated,
          COALESCE(sd.raids_defended,0) raids_defended,
          COALESCE(sd.bradley_participations,0) bradley_participations,
          COALESCE(sd.heli_participations,0) heli_participations,
          COALESCE(sd.crates_hacked,0) crates_hacked,
          COALESCE(sd.sulfur_ore,0) sulfur_ore,COALESCE(sd.hqm_ore,0) hqm_ore,
          COALESCE(sd.updated_at,r.created_at) updated_at,
          (sd.steam_id IS NOT NULL) season_scored
        FROM registered r
        LEFT JOIN sd ON sd.steam_id=r.steam_id
      ),
      ranked AS (
        SELECT u.*,u.mmr+COALESCE(a.delta,0) effective_mmr,
          ROW_NUMBER() OVER(ORDER BY u.mmr+COALESCE(a.delta,0) DESC,u.kills DESC,u.updated_at ASC NULLS LAST) position
        FROM u
        LEFT JOIN adjustments a ON a.steam_id=u.steam_id
      )
      SELECT * FROM ranked
    `;
  }

  return sql`
    WITH adjustments AS (
      SELECT steam_id,COALESCE(SUM(final_value),0) delta
      FROM season_transactions
      WHERE season_number=${seasonNumber} AND category='admin'
      GROUP BY steam_id
    ),
    ranked AS (
      SELECT p.*,p.mmr+COALESCE(a.delta,0) effective_mmr,true season_scored,
        ROW_NUMBER() OVER(ORDER BY p.mmr+COALESCE(a.delta,0) DESC,p.kills DESC,p.updated_at ASC NULLS LAST) position
      FROM season_players p
      LEFT JOIN adjustments a ON a.steam_id=p.steam_id
      WHERE p.season_number=${seasonNumber}
    )
    SELECT * FROM ranked
  `;
}

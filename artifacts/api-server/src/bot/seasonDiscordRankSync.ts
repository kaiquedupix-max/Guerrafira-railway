import { type Client, type GuildMember } from "discord.js";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";

const OFFICIAL_KEY = 101;
const STARTING_MMR = 1000;
const MARECHAL_XP = 1800;
const SEASON_REGISTERED_ROLE_ID = "1543718255972057188";
const PREFIX_RE = /^\[(?:SLD|TEN|MAJ|MJR|MAR|GFR)\]\s*/i;

const RANK_ROLE_IDS = {
  SLD: "1544028734632231014",
  TEN: "1544029353132695674",
  MAJ: "1544029683270684775",
  MAR: "1544029869015433278",
  GFR: "1544030006194208858",
} as const;

const ALL_RANK_ROLE_IDS = Object.values(RANK_ROLE_IDS);
let timer: NodeJS.Timeout | null = null;
let running = false;

type RankCode = keyof typeof RANK_ROLE_IDS;
type Enrolled = {
  discord_id: string;
  steam_id: string;
  effective_mmr: number | string | null;
  position: number | string | null;
};

function xpFromMmr(value: unknown): number {
  const mmr = Number(value);
  return Math.max(0, Math.round(((Number.isFinite(mmr) ? mmr : STARTING_MMR) - STARTING_MMR) * 9));
}

function rankCode(effectiveMmr: unknown, position: unknown): RankCode {
  const xp = xpFromMmr(effectiveMmr);
  const pos = Math.trunc(Number(position) || 0);
  if (pos === 1 && xp >= MARECHAL_XP) return "GFR";
  if (xp >= 1800) return "MAR";
  if (xp >= 1200) return "MAJ";
  if (xp >= 600) return "TEN";
  return "SLD";
}

function nicknameWithoutSeasonTag(member: GuildMember): string | null {
  if (!member.nickname || !PREFIX_RE.test(member.nickname)) return null;
  const cleaned = member.nickname.replace(PREFIX_RE, "").trim();
  return cleaned ? cleaned.slice(0, 32) : null;
}

async function enrolledPlayers(): Promise<Enrolled[]> {
  const result: any = await db.execute(sql`
    WITH source_season AS (
      SELECT COALESCE((
        SELECT p.season_number
        FROM season_players p
        LEFT JOIN seasons s ON s.season_number=p.season_number
        GROUP BY p.season_number
        ORDER BY CASE WHEN MAX(s.status)='active' THEN 0 ELSE 1 END,
                 MAX(p.updated_at) DESC NULLS LAST
        LIMIT 1
      ),1) AS season_number
    ),
    sd AS (
      SELECT p.steam_id,p.mmr,p.kills,p.updated_at
      FROM season_players p, source_season sn
      WHERE p.season_number=sn.season_number
    ),
    adjustments AS (
      SELECT t.steam_id,COALESCE(SUM(t.final_value),0) delta
      FROM season_transactions t, source_season sn
      WHERE t.season_number=sn.season_number AND t.category='admin'
      GROUP BY t.steam_id
    ),
    universe AS (
      SELECT ps.steam_id,COALESCE(sd.mmr,${STARTING_MMR}) mmr,
             COALESCE(sd.kills,ps.kills,0) kills,COALESCE(sd.updated_at,ps.updated_at) updated_at
      FROM player_stats ps
      LEFT JOIN sd ON sd.steam_id=ps.steam_id
      UNION ALL
      SELECT sd.steam_id,sd.mmr,sd.kills,sd.updated_at
      FROM sd
      LEFT JOIN player_stats ps ON ps.steam_id=sd.steam_id
      WHERE ps.steam_id IS NULL
    ),
    ranked AS (
      SELECT u.steam_id,u.mmr+COALESCE(a.delta,0) effective_mmr,
             ROW_NUMBER() OVER(ORDER BY u.mmr+COALESCE(a.delta,0) DESC,u.kills DESC,u.updated_at ASC NULLS LAST) position
      FROM universe u
      LEFT JOIN adjustments a ON a.steam_id=u.steam_id
    )
    SELECT r.discord_id,r.steam_id,COALESCE(rank.effective_mmr,${STARTING_MMR}) effective_mmr,
           COALESCE(rank.position,0) position
    FROM season_official_registrations r
    LEFT JOIN ranked rank ON rank.steam_id=r.steam_id
    WHERE r.season_key=${OFFICIAL_KEY} AND r.status='active'
  `);
  return (result?.rows || []) as Enrolled[];
}

async function syncRankRole(member: GuildMember, code: RankCode): Promise<boolean> {
  const targetRoleId = RANK_ROLE_IDS[code];
  const currentRankRoleIds = ALL_RANK_ROLE_IDS.filter(roleId => member.roles.cache.has(roleId));
  const toRemove = currentRankRoleIds.filter(roleId => roleId !== targetRoleId);
  let changed = false;

  if (toRemove.length) {
    await member.roles.remove(toRemove, `Atualização de patente da Guerra Fria Season 1 • ${code}`);
    changed = true;
  }
  if (!member.roles.cache.has(targetRoleId)) {
    await member.roles.add(targetRoleId, `Patente Guerra Fria Season 1 • ${code}`);
    changed = true;
  }
  return changed;
}

async function syncOnce(client: Client): Promise<void> {
  if (running) return;
  running = true;
  try {
    const guildId = String(process.env.DISCORD_GUILD_ID || "").trim();
    if (!guildId) return;
    const guild = await client.guilds.fetch(guildId);
    const rows = await enrolledPlayers();
    let rankRolesChanged = 0, registeredRolesAdded = 0, tagsRemoved = 0, unmanaged = 0, failures = 0;

    for (const row of rows) {
      const member = await guild.members.fetch(row.discord_id).catch(() => null);
      if (!member || member.user.bot) continue;

      if (!member.roles.cache.has(SEASON_REGISTERED_ROLE_ID)) {
        await member.roles.add(SEASON_REGISTERED_ROLE_ID, "Inscrito na Guerra Fria Season 1").then(() => {
          registeredRolesAdded++;
        }).catch((error) => {
          failures++;
          logger.warn({ error, discordId: member.id, roleId: SEASON_REGISTERED_ROLE_ID }, "Could not assign Season registered role");
        });
      }

      const code = rankCode(row.effective_mmr, row.position);
      await syncRankRole(member, code).then(changed => {
        if (changed) rankRolesChanged++;
      }).catch((error) => {
        failures++;
        logger.warn({ error, discordId: member.id, code, targetRoleId: RANK_ROLE_IDS[code] }, "Could not sync Season Discord rank role");
      });

      const cleanedNickname = nicknameWithoutSeasonTag(member);
      if (cleanedNickname !== null) {
        if (!member.manageable) {
          unmanaged++;
        } else {
          await member.setNickname(cleanedNickname, "Remoção da tag antiga de patente da Guerra Fria Season 1").then(() => {
            tagsRemoved++;
          }).catch((error) => {
            failures++;
            logger.warn({ error, discordId: member.id }, "Could not remove old Season Discord nickname tag");
          });
        }
      }

      await new Promise(resolve => setTimeout(resolve, 250));
    }

    if (rankRolesChanged || registeredRolesAdded || tagsRemoved || unmanaged || failures) {
      logger.info({ enrolled: rows.length, rankRolesChanged, registeredRolesAdded, tagsRemoved, unmanaged, failures }, "Season Discord role sync completed");
    }
  } catch (error) {
    logger.error({ error }, "Season Discord role sync failed");
  } finally {
    running = false;
  }
}

export function startSeasonDiscordRankSync(client: Client): void {
  if (timer) return;
  void syncOnce(client);
  timer = setInterval(() => void syncOnce(client), 60_000);
  timer.unref?.();
}

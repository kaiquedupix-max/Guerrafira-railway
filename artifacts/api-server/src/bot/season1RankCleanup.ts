import { type Client, type GuildMember } from "discord.js";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { executeRconCommand } from "./utils/rcon.js";

const SEASON_1_KEY = 101;
const RETRY_MS = 10 * 60_000;
const OLD_GAME_GROUPS = [
  "season_recruta",
  "season_soldado",
  "season_tenente",
  "season_major",
  "season_marechal",
  "season_generalfrio",
] as const;
const OLD_DISCORD_RANK_ROLE_IDS = [
  "1544028734632231014", // Soldado
  "1544029353132695674", // Tenente
  "1544029683270684775", // Major
  "1544029869015433278", // Marechal
  "1544030006194208858", // General Frio
] as const;
const OLD_NICKNAME_PREFIX = /^\[(?:SLD|TEN|MAJ|MJR|MAR|GFR)\]\s*/i;

let gameRunning = false;
let gameComplete = false;
let gameTimer: NodeJS.Timeout | null = null;
let discordRunning = false;
let discordComplete = false;
let discordTimer: NodeJS.Timeout | null = null;

function validSteam(value: unknown): boolean {
  return /^7656119\d{10}$/.test(String(value || ""));
}

async function season1SteamIds(): Promise<string[]> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS season_game_rank_state (
      steam_id TEXT PRIMARY KEY,
      season_key INTEGER NOT NULL DEFAULT 102,
      current_group TEXT,
      active BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  const result: any = await db.execute(sql`
    SELECT DISTINCT steam_id FROM (
      SELECT steam_id FROM season_official_registrations WHERE season_key=${SEASON_1_KEY}
      UNION
      SELECT steam_id FROM season_players WHERE season_number=1
      UNION
      SELECT steam_id FROM season_game_rank_state
      WHERE current_group IN ('season_recruta','season_soldado','season_tenente','season_major','season_marechal','season_generalfrio')
    ) players
    WHERE steam_id IS NOT NULL AND TRIM(steam_id)<>''
  `);
  return (result?.rows || []).map((row: any) => String(row.steam_id || "").trim()).filter(validSteam);
}

export async function cleanupSeason1GameRanksOnce(): Promise<void> {
  if (gameRunning || gameComplete) return;
  gameRunning = true;
  try {
    const steamIds = await season1SteamIds();
    let removed = 0;
    let failures = 0;
    for (const steamId of steamIds) {
      let playerOk = true;
      for (const group of OLD_GAME_GROUPS) {
        const reply = await executeRconCommand(`chat user remove ${steamId} ${group}`);
        if (reply === null) {
          playerOk = false;
          failures++;
          logger.warn({ steamId, group }, "Could not remove Season 1 Rust rank group");
        }
      }
      if (playerOk) removed++;
    }
    if (!failures) {
      await db.execute(sql`
        UPDATE season_game_rank_state
        SET current_group=NULL,active=FALSE,updated_at=now()
        WHERE season_key=${SEASON_1_KEY}
      `);
      gameComplete = true;
      if (gameTimer) clearInterval(gameTimer);
      gameTimer = null;
    }
    logger.info({ players: steamIds.length, removed, failures }, "Season 1 Rust rank cleanup completed");
  } catch (error) {
    logger.error({ error }, "Season 1 Rust rank cleanup failed and will retry");
  } finally {
    gameRunning = false;
  }
}

function cleanNickname(member: GuildMember): string | null | undefined {
  if (!member.nickname || !OLD_NICKNAME_PREFIX.test(member.nickname)) return undefined;
  const cleaned = member.nickname.replace(OLD_NICKNAME_PREFIX, "").trim();
  return cleaned ? cleaned.slice(0, 32) : null;
}

export async function cleanupSeason1DiscordRanksOnce(client: Client): Promise<void> {
  if (discordRunning || discordComplete) return;
  discordRunning = true;
  try {
    const guildId = String(process.env.DISCORD_GUILD_ID || "").trim();
    if (!guildId) return;
    const guild = await client.guilds.fetch(guildId);
    await guild.roles.fetch();
    const members = await guild.members.fetch();
    let rolesRemoved = 0;
    let tagsRemoved = 0;
    let failures = 0;

    for (const member of members.values()) {
      if (member.user.bot) continue;
      const oldRoleIds = OLD_DISCORD_RANK_ROLE_IDS.filter(roleId => member.roles.cache.has(roleId));
      const nickname = cleanNickname(member);
      if (!oldRoleIds.length && nickname === undefined) continue;

      if (oldRoleIds.length) {
        await member.roles.remove(oldRoleIds, "Encerramento da Guerra Fria Season 1").then(() => {
          rolesRemoved += oldRoleIds.length;
        }).catch(error => {
          failures++;
          logger.warn({ error, discordId: member.id, roleIds: oldRoleIds }, "Could not remove Season 1 Discord rank roles");
        });
      }
      if (nickname !== undefined) {
        if (!member.manageable) {
          failures++;
          logger.warn({ discordId: member.id }, "Could not remove Season 1 nickname tag because member is not manageable");
        } else {
          await member.setNickname(nickname, "Encerramento da Guerra Fria Season 1").then(() => {
            tagsRemoved++;
          }).catch(error => {
            failures++;
            logger.warn({ error, discordId: member.id }, "Could not remove Season 1 Discord nickname tag");
          });
        }
      }
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    if (!failures) {
      discordComplete = true;
      if (discordTimer) clearInterval(discordTimer);
      discordTimer = null;
    }
    logger.info({ members: members.size, rolesRemoved, tagsRemoved, failures }, "Season 1 Discord rank cleanup completed");
  } catch (error) {
    logger.error({ error }, "Season 1 Discord rank cleanup failed and will retry");
  } finally {
    discordRunning = false;
  }
}

export function startSeason1GameRankCleanup(): void {
  if (gameTimer || gameComplete) return;
  void cleanupSeason1GameRanksOnce();
  gameTimer = setInterval(() => void cleanupSeason1GameRanksOnce(), RETRY_MS);
  gameTimer.unref?.();
}

export function startSeason1DiscordRankCleanup(client: Client): void {
  if (discordTimer || discordComplete) return;
  void cleanupSeason1DiscordRanksOnce(client);
  discordTimer = setInterval(() => void cleanupSeason1DiscordRanksOnce(client), RETRY_MS);
  discordTimer.unref?.();
}

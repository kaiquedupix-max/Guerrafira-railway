import { db, playersTable } from "@workspace/db";
import { eq, ilike, desc, count, sql, or } from "drizzle-orm";
import type { RconPlayer } from "./rcon.js";

export async function upsertPlayer(player: RconPlayer): Promise<void> {
  await db
    .insert(playersTable)
    .values({
      steamId: player.steamId,
      playerName: player.name,
      isOnline: true,
      lastSeen: new Date(),
    })
    .onConflictDoUpdate({
      target: playersTable.steamId,
      set: {
        playerName: player.name,
        isOnline: true,
        lastSeen: new Date(),
      },
    });
}

export async function setAllOffline(): Promise<void> {
  await db.update(playersTable).set({ isOnline: false });
}

export async function searchPlayers(query: string, limit = 25) {
  const trimmed = query.trim();

  if (!trimmed) {
    return db
      .select()
      .from(playersTable)
      .orderBy(sql`${playersTable.isOnline} DESC`, desc(playersTable.lastSeen))
      .limit(limit);
  }

  return db
    .select()
    .from(playersTable)
    .where(
      or(
        ilike(playersTable.playerName, `%${trimmed}%`),
        ilike(playersTable.steamId, `%${trimmed}%`),
      )
    )
    .orderBy(sql`${playersTable.isOnline} DESC`, desc(playersTable.lastSeen))
    .limit(limit);
}

export async function getAllPlayers(limit = 25) {
  return db
    .select()
    .from(playersTable)
    .orderBy(sql`${playersTable.isOnline} DESC`, desc(playersTable.lastSeen))
    .limit(limit);
}

export async function getPlayersPage(query: string, page: number, pageSize = 10) {
  const offset = page * pageSize;
  const trimmed = query.trim();
  const condition = trimmed
    ? or(
        ilike(playersTable.playerName, `%${trimmed}%`),
        ilike(playersTable.steamId, `%${trimmed}%`),
      )
    : undefined;

  const [rows, countRes] = await Promise.all([
    db.select().from(playersTable)
      .where(condition)
      .orderBy(sql`${playersTable.isOnline} DESC`, desc(playersTable.lastSeen))
      .limit(pageSize).offset(offset),
    db.select({ total: count() }).from(playersTable).where(condition),
  ]);

  return { rows, total: Number(countRes[0]?.total ?? 0) };
}

export async function getPlayerBySteamId(steamId: string) {
  const [player] = await db
    .select()
    .from(playersTable)
    .where(eq(playersTable.steamId, steamId))
    .limit(1);
  return player ?? null;
}

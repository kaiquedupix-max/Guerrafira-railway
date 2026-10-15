import { adminServer } from "../../core/adminServerContext.js";
import { getOnlinePlayers } from "./rcon.js";
import { db, playersTable, modLogsTable } from "@workspace/db";
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
  if (adminServer() === "trio") {
    const q = query.trim().toLowerCase();
    const [online, history] = await Promise.all([
      getOnlinePlayers(),
      db.select().from(modLogsTable).where(eq(modLogsTable.serverId, "trio")).orderBy(desc(modLogsTable.id)).limit(2000),
    ]);
    const rows = new Map<string, { id: number; steamId: string; playerName: string; isOnline: boolean; firstSeen: Date; lastSeen: Date }>();
    for (const row of history) if (/^7656119\d{10}$/.test(row.steamId) && !rows.has(row.steamId)) rows.set(row.steamId, {
      id: row.id, steamId: row.steamId, playerName: row.playerName, isOnline: false, firstSeen: row.createdAt, lastSeen: row.createdAt,
    });
    for (const p of online) rows.set(p.steamId, { id: 0, steamId: p.steamId, playerName: p.name, isOnline: true, firstSeen: new Date(), lastSeen: new Date() });
    return [...rows.values()].filter(p => !q || p.playerName.toLowerCase().includes(q) || p.steamId.includes(q))
      .sort((a, b) => Number(b.isOnline) - Number(a.isOnline)).slice(0, limit);
  }
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
  if (adminServer() === "trio") return searchPlayers("", limit);
  return db
    .select()
    .from(playersTable)
    .orderBy(sql`${playersTable.isOnline} DESC`, desc(playersTable.lastSeen))
    .limit(limit);
}

export async function getPlayersPage(query: string, page: number, pageSize = 10) {
  if (adminServer() === "trio") {
    const rows = await searchPlayers(query, 1000);
    return { rows: rows.slice(page * pageSize, (page + 1) * pageSize), total: rows.length };
  }
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
  if (adminServer() === "trio") return (await searchPlayers(steamId, 1)).find(p => p.steamId === steamId) ?? null;
  const [player] = await db
    .select()
    .from(playersTable)
    .where(eq(playersTable.steamId, steamId))
    .limit(1);
  return player ?? null;
}

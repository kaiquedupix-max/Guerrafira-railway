import { db, boosterLinksTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

export async function getLinkedSteamV2(discordUserId: string) {
  const [direct] = await db.select().from(boosterLinksTable)
    .where(eq(boosterLinksTable.discordUserId, discordUserId)).limit(1);
  // Payment/VIP history describes past deliveries, never the current login identity.
  // Reading the site must not recreate a link explicitly removed by an administrator.
  return direct ?? null;
}

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
async function clearOfficialSteam(tx: Transaction, discordUserId: string) {
  await tx.execute(sql`CREATE TABLE IF NOT EXISTS store_steam_auth (
    discord_id TEXT PRIMARY KEY, steam_id TEXT NOT NULL, verified_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await tx.execute(sql`DELETE FROM store_steam_auth WHERE discord_id=${discordUserId}`);
}

export async function unlinkSteamV2(discordUserId: string) {
  return db.transaction(async tx => {
    await clearOfficialSteam(tx, discordUserId);
    const [removed] = await tx.delete(boosterLinksTable)
      .where(eq(boosterLinksTable.discordUserId, discordUserId)).returning();
    return removed ?? null;
  });
}

export async function replaceLinkedSteamV2(discordUserId: string, steamId: string) {
  return db.transaction(async tx => {
    await clearOfficialSteam(tx, discordUserId);
    const [row] = await tx.insert(boosterLinksTable)
      .values({discordUserId,steamId,active:false,updatedAt:new Date()})
      .onConflictDoUpdate({target:boosterLinksTable.discordUserId,set:{steamId,updatedAt:new Date()}}).returning();
    return row;
  });
}

export async function saveLinkedSteamV2(discordUserId: string, steamId: string) {
  const current = await getLinkedSteamV2(discordUserId);
  if (current) return current.steamId === steamId ? { ok: true as const, row: current } : { ok: false as const, reason: "discord-linked" as const, row: current };

  const [owner] = await db.select().from(boosterLinksTable)
    .where(eq(boosterLinksTable.steamId, steamId)).limit(1);
  if (owner && owner.discordUserId !== discordUserId) return { ok: false as const, reason: "steam-linked" as const, row: owner };

  const [row] = await db.insert(boosterLinksTable)
    .values({ discordUserId, steamId, active: false, updatedAt: new Date() }).returning();
  return { ok: true as const, row };
}

export const STEAM_LOCKED_NOTICE = "🔒 Esta conta já possui uma Steam vinculada. Por segurança, o SteamID não pode ser alterado por aqui. Se precisar alterar a Steam vinculada, abra um ticket e fale com a administração.";

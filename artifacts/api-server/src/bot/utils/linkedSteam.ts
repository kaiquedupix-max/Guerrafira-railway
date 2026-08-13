import { db, boosterLinksTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export async function getLinkedSteam(discordUserId: string) {
  const [row] = await db.select().from(boosterLinksTable).where(eq(boosterLinksTable.discordUserId, discordUserId)).limit(1);
  return row ?? null;
}

export async function getSteamOwner(steamId: string) {
  const [row] = await db.select().from(boosterLinksTable).where(eq(boosterLinksTable.steamId, steamId)).limit(1);
  return row ?? null;
}

export async function saveSteamLink(discordUserId: string, steamId: string) {
  const current = await getLinkedSteam(discordUserId);
  if (current) return current.steamId === steamId ? { ok: true as const, row: current } : { ok: false as const, reason: "discord-linked" as const, row: current };
  const owner = await getSteamOwner(steamId);
  if (owner && owner.discordUserId !== discordUserId) return { ok: false as const, reason: "steam-linked" as const, row: owner };
  const [row] = await db.insert(boosterLinksTable).values({ discordUserId, steamId, active: false, updatedAt: new Date() }).returning();
  return { ok: true as const, row };
}

export const STEAM_CHANGE_NOTICE = "🔒 Esta conta já possui uma Steam vinculada. Por segurança, o SteamID não pode ser alterado por aqui. Se precisar alterar a Steam vinculada, abra um ticket e fale com a administração.";

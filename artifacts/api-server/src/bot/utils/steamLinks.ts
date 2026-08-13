import { db, steamLinksTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export async function getSteamLinkByDiscord(discordUserId: string) {
  const [row] = await db.select().from(steamLinksTable).where(eq(steamLinksTable.discordUserId, discordUserId)).limit(1);
  return row ?? null;
}

export async function getSteamLinkBySteam(steamId: string) {
  const [row] = await db.select().from(steamLinksTable).where(eq(steamLinksTable.steamId, steamId)).limit(1);
  return row ?? null;
}

export async function bindSteam(discordUserId: string, steamId: string): Promise<{ ok: true } | { ok: false; reason: "discord-linked" | "steam-linked"; existingSteamId?: string }> {
  const byDiscord = await getSteamLinkByDiscord(discordUserId);
  if (byDiscord) {
    if (byDiscord.steamId === steamId) return { ok: true };
    return { ok: false, reason: "discord-linked", existingSteamId: byDiscord.steamId };
  }

  const bySteam = await getSteamLinkBySteam(steamId);
  if (bySteam && bySteam.discordUserId !== discordUserId) return { ok: false, reason: "steam-linked" };

  await db.insert(steamLinksTable).values({ discordUserId, steamId, updatedAt: new Date() });
  return { ok: true };
}

export const STEAM_LOCKED_MESSAGE = "🔒 Esta conta já possui uma Steam vinculada. Por segurança, o SteamID não pode ser alterado por aqui. Se precisar trocar a Steam vinculada, abra um ticket e fale com a administração.";

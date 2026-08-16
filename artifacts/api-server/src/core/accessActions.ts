import { eq } from "drizzle-orm";
import { db, boosterLinksTable } from "@workspace/db";
import { executeRconRequired, ActionError } from "./systemActions.js";

export async function setBoosterAccess(discordUserId: string, active: boolean, reason: string) {
  const [link] = await db.select().from(boosterLinksTable)
    .where(eq(boosterLinksTable.discordUserId, discordUserId)).limit(1);
  if (!link) throw new ActionError("Discord sem Steam vinculada.", 404);
  await executeRconRequired(`c.usergroup ${active ? "add" : "remove"} ${link.steamId} bs`);
  await db.update(boosterLinksTable).set({
    active,
    manuallyDisabled: !active,
    updatedAt: new Date(),
  }).where(eq(boosterLinksTable.discordUserId, discordUserId));
  return { steamId: link.steamId, active, reason };
}

export async function unlinkSteamAccess(discordUserId: string) {
  const [link] = await db.select().from(boosterLinksTable)
    .where(eq(boosterLinksTable.discordUserId, discordUserId)).limit(1);
  if (!link) throw new ActionError("Vínculo não encontrado.", 404);
  if (link.active) await executeRconRequired(`c.usergroup remove ${link.steamId} bs`);
  await db.delete(boosterLinksTable).where(eq(boosterLinksTable.discordUserId, discordUserId));
  return { steamId: link.steamId };
}

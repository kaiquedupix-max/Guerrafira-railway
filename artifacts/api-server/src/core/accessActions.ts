import { syncBoosterServers } from "../bot/utils/boosterServers.js";
import { unlinkSteamV2 } from "../bot/utils/linkedSteamV2.js";
import { eq } from "drizzle-orm";
import { db, boosterLinksTable } from "@workspace/db";
import { ActionError } from "./systemActions.js";

export async function setBoosterAccess(discordUserId: string, active: boolean, reason: string) {
  const [link] = await db.select().from(boosterLinksTable)
    .where(eq(boosterLinksTable.discordUserId, discordUserId)).limit(1);
  if (!link) throw new ActionError("Discord sem Steam vinculada.", 404);
  // Persist the administrative block first so a partial removal cannot be regranted.
  if (!active) await db.update(boosterLinksTable).set({ active: false, manuallyDisabled: true, updatedAt: new Date() })
    .where(eq(boosterLinksTable.discordUserId, discordUserId));
  if (await syncBoosterServers(link.steamId, active) === null) throw new ActionError("Um dos servidores não confirmou a alteração do Booster.", 503);
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
  if (!link) { await unlinkSteamV2(discordUserId); throw new ActionError("Vínculo não encontrado.", 404); }
  if (link.active && await syncBoosterServers(link.steamId, false) === null) throw new ActionError("Um dos servidores não confirmou a remoção do Booster.", 503);
  await unlinkSteamV2(discordUserId);
  return { steamId: link.steamId };
}

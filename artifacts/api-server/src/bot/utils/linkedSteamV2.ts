import { db, boosterLinksTable, paymentsTable, vipSubscriptionsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";

function isSteamId(value: unknown): value is string {
  return typeof value === "string" && /^\d{17}$/.test(value);
}

export async function getLinkedSteamV2(discordUserId: string) {
  const [direct] = await db.select().from(boosterLinksTable)
    .where(eq(boosterLinksTable.discordUserId, discordUserId)).limit(1);
  if (direct) return direct;

  const [payment] = await db.select({ steamId: paymentsTable.steamId }).from(paymentsTable)
    .where(eq(paymentsTable.discordUserId, discordUserId)).orderBy(desc(paymentsTable.createdAt)).limit(1);

  let steamId = isSteamId(payment?.steamId) ? payment.steamId : null;
  if (!steamId) {
    const [vip] = await db.select({ steamId: vipSubscriptionsTable.steamId }).from(vipSubscriptionsTable)
      .where(eq(vipSubscriptionsTable.discordUserId, discordUserId)).orderBy(desc(vipSubscriptionsTable.createdAt)).limit(1);
    steamId = isSteamId(vip?.steamId) ? vip.steamId : null;
  }
  if (!steamId) return null;

  const [owner] = await db.select().from(boosterLinksTable)
    .where(eq(boosterLinksTable.steamId, steamId)).limit(1);
  if (owner && owner.discordUserId !== discordUserId) return null;

  await db.insert(boosterLinksTable)
    .values({ discordUserId, steamId, active: false, updatedAt: new Date() })
    .onConflictDoNothing();

  const [linked] = await db.select().from(boosterLinksTable)
    .where(eq(boosterLinksTable.discordUserId, discordUserId)).limit(1);
  return linked ?? null;
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

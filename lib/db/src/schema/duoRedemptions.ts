import { pgTable, integer, text, timestamp } from "drizzle-orm/pg-core";
import { paymentsTable } from "./payments";
export const duoRedemptionsTable = pgTable("duo_redemptions", {
  paymentId: integer("payment_id").primaryKey().references(() => paymentsTable.id),
  nonce: text("nonce").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone:true }).notNull(),
  status: text("status").notNull().default("available"),
  duoDiscordId: text("duo_discord_id"),
  duoSteamId: text("duo_steam_id"),
  redeemedAt: timestamp("redeemed_at", { withTimezone:true }),
  createdAt: timestamp("created_at", { withTimezone:true }).notNull().defaultNow(),
});
export const storeSteamAuthTable = pgTable("store_steam_auth", {
  discordId: text("discord_id").primaryKey(), steamId: text("steam_id").notNull(),
  verifiedAt: timestamp("verified_at", { withTimezone:true }).notNull().defaultNow(),
});

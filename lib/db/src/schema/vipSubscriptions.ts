import { pgTable, serial, varchar, integer, boolean, timestamp } from "drizzle-orm/pg-core";

export const vipSubscriptionsTable = pgTable("vip_subscriptions", {
  id:                 serial("id").primaryKey(),
  discordUserId:      varchar("discord_user_id", { length: 64 }).notNull(),
  steamId:            varchar("steam_id", { length: 32 }).notNull(),
  vipTier:            varchar("vip_tier", { length: 16 }).notNull(),   // bronze | prata | ouro
  source:             varchar("source", { length: 16 }).notNull(),     // purchase | raffle
  durationDays:       integer("duration_days").notNull().default(30),
  startsAt:           timestamp("starts_at").notNull(),
  expiresAt:          timestamp("expires_at").notNull(),
  discordRoleRemoved: boolean("discord_role_removed").notNull().default(false),
  gameVipRemoved:     boolean("game_vip_removed").notNull().default(false),
  createdAt:          timestamp("created_at").defaultNow().notNull(),
});

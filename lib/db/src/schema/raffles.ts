import { pgTable, serial, varchar, integer, timestamp } from "drizzle-orm/pg-core";

export const rafflesTable = pgTable("raffles", {
  id:               serial("id").primaryKey(),
  prizeTier:        varchar("prize_tier", { length: 16 }).notNull(),
  prizeDurationDays: integer("prize_duration_days").notNull(),
  messageId:        varchar("message_id", { length: 64 }),
  channelId:        varchar("channel_id", { length: 64 }),
  endsAt:           timestamp("ends_at").notNull(),
  status:           varchar("status", { length: 16 }).notNull().default("active"),
  winnerDiscordId:  varchar("winner_discord_id", { length: 64 }),
  winnerSteamId:    varchar("winner_steam_id", { length: 32 }),
  createdBy:        varchar("created_by", { length: 64 }).notNull(),
  createdAt:        timestamp("created_at").defaultNow().notNull(),
});

export const raffleEntriesTable = pgTable("raffle_entries", {
  id:            serial("id").primaryKey(),
  raffleId:      integer("raffle_id").notNull(),
  discordUserId: varchar("discord_user_id", { length: 64 }).notNull(),
  steamId:       varchar("steam_id", { length: 32 }).notNull(),
  enteredAt:     timestamp("entered_at").defaultNow().notNull(),
});

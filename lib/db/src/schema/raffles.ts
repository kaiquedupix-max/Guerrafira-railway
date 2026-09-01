import { pgTable, serial, varchar, integer, timestamp, text, boolean } from "drizzle-orm/pg-core";

export const rafflesTable = pgTable("raffles", {
  id:               serial("id").primaryKey(),
  prizeTier:        varchar("prize_tier", { length: 16 }).notNull(),
  prizeDurationDays: integer("prize_duration_days").notNull(),
  prizeText:        text("prize_text"),
  vipOnly:          boolean("vip_only").notNull().default(false),
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

/** Votações de mapa persistentes: sobrevivem a reinícios/deploys do bot. */
export const mapVotesTable = pgTable("map_votes", {
  id:          serial("id").primaryKey(),
  messageId:   varchar("message_id", { length: 64 }).notNull().unique(),
  channelId:   varchar("channel_id", { length: 64 }).notNull(),
  mapsJson:    text("maps_json").notNull(),
  endsAt:      timestamp("ends_at").notNull(),
  wipeAt:      timestamp("wipe_at"),
  winnerIndex: integer("winner_index"),
  appliedAt:   timestamp("applied_at"),
  failureReason: text("failure_reason"),
  status:      varchar("status", { length: 16 }).notNull().default("active"),
  createdBy:   varchar("created_by", { length: 64 }).notNull(),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
});

export const mapVoteBallotsTable = pgTable("map_vote_ballots", {
  id:            serial("id").primaryKey(),
  mapVoteId:     integer("map_vote_id").notNull(),
  discordUserId: varchar("discord_user_id", { length: 64 }).notNull(),
  optionIndex:   integer("option_index").notNull(),
  weight:        integer("weight").notNull().default(1),
  isVip:         boolean("is_vip").notNull().default(false),
  isBooster:     boolean("is_booster").notNull().default(false),
  updatedAt:     timestamp("updated_at").defaultNow().notNull(),
});

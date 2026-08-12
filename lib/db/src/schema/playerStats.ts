import { pgTable, serial, text, integer, real, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const playerStatsTable = pgTable("player_stats", {
  id:                serial("id").primaryKey(),
  steamId:           text("steam_id").notNull().unique(),
  playerName:        text("player_name").notNull(),
  kills:             integer("kills").notNull().default(0),
  deaths:            integer("deaths").notNull().default(0),
  headshots:         integer("headshots").notNull().default(0),
  resourcesGathered: integer("resources_gathered").notNull().default(0),
  explosivesCrafted: integer("explosives_crafted").notNull().default(0),
  updatedAt:         timestamp("updated_at").notNull().default(sql`now()`),
});

import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const playerStatsTable = pgTable("player_stats", {
  id:                serial("id").primaryKey(),
  steamId:           text("steam_id").notNull().unique(),
  playerName:        text("player_name").notNull(),
  kills:             integer("kills").notNull().default(0),
  deaths:            integer("deaths").notNull().default(0),
  headshots:         integer("headshots").notNull().default(0),
  resourcesGathered: integer("resources_gathered").notNull().default(0),
  woodGathered:      integer("wood_gathered").notNull().default(0),
  stoneGathered:     integer("stone_gathered").notNull().default(0),
  metalOreGathered:  integer("metal_ore_gathered").notNull().default(0),
  sulfurOreGathered: integer("sulfur_ore_gathered").notNull().default(0),
  scrapGathered:     integer("scrap_gathered").notNull().default(0),
  explosivesCrafted: integer("explosives_crafted").notNull().default(0),
  gunpowderCrafted:  integer("gunpowder_crafted").notNull().default(0),
  updatedAt:         timestamp("updated_at").notNull().default(sql`now()`),
});

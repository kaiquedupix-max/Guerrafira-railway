import { pgTable, serial, varchar, boolean, timestamp } from "drizzle-orm/pg-core";

export const boosterLinksTable = pgTable("booster_links", {
  id: serial("id").primaryKey(),
  discordUserId: varchar("discord_user_id", { length: 64 }).notNull().unique(),
  steamId: varchar("steam_id", { length: 32 }).notNull(),
  active: boolean("active").notNull().default(false),
  manuallyDisabled: boolean("manually_disabled").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

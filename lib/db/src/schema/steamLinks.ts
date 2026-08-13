import { pgTable, serial, varchar, timestamp } from "drizzle-orm/pg-core";

export const steamLinksTable = pgTable("steam_links", {
  id: serial("id").primaryKey(),
  discordUserId: varchar("discord_user_id", { length: 64 }).notNull().unique(),
  steamId: varchar("steam_id", { length: 32 }).notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

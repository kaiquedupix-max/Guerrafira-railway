import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const modLogsTable = pgTable("mod_logs", {
  id: serial("id").primaryKey(),
  action: text("action").notNull(), // BAN | KICK | VERIFICAR | SYSTEM_UNBAN
  steamId: text("steam_id").notNull(),
  playerName: text("player_name").notNull(),
  reason: text("reason"),
  adminId: text("admin_id").notNull(),
  adminName: text("admin_name").notNull(),
  banDuration: text("ban_duration"), // "3d" | "7d" | "30d" | "perm" | null
  banExpiresAt: timestamp("ban_expires_at", { withTimezone: true }), // null = permanent
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertModLogSchema = createInsertSchema(modLogsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertModLog = z.infer<typeof insertModLogSchema>;
export type ModLog = typeof modLogsTable.$inferSelect;

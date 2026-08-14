import { pgTable, serial, text, timestamp, boolean } from "drizzle-orm/pg-core";

export const adminNotificationSubscriptionsTable = pgTable("admin_notification_subscriptions", {
  id: serial("id").primaryKey(),
  discordUserId: text("discord_user_id").notNull().unique(),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

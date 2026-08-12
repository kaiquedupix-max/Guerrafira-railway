import { pgTable, serial, varchar, timestamp, text } from "drizzle-orm/pg-core";

export const ticketLogsTable = pgTable("ticket_logs", {
  id:                serial("id").primaryKey(),
  ticketChannelId:   varchar("ticket_channel_id", { length: 64 }).notNull().unique(),
  channelName:       varchar("channel_name", { length: 128 }),
  type:              varchar("type", { length: 32 }),
  openedByDiscordId: varchar("opened_by_discord_id", { length: 64 }).notNull().default(""),
  openedByUsername:  varchar("opened_by_username", { length: 128 }),
  closedByDiscordId: varchar("closed_by_discord_id", { length: 64 }),
  closedByUsername:  varchar("closed_by_username", { length: 128 }),
  openedAt:          timestamp("opened_at").defaultNow().notNull(),
  closedAt:          timestamp("closed_at"),
  /** JSON-encoded TranscriptMsg[] */
  transcript:        text("transcript"),
  /** Comma-separated Discord user IDs que enviaram mensagens no ticket */
  participantIds:    text("participant_ids"),
});

import { pgTable, serial, varchar, timestamp } from "drizzle-orm/pg-core";

export const paymentsTable = pgTable("payments", {
  id:              serial("id").primaryKey(),
  mpPaymentId:     varchar("mp_payment_id", { length: 64 }),
  mpPreferenceId:  varchar("mp_preference_id", { length: 128 }),
  mpExternalReference: varchar("mp_external_reference", { length: 128 }),
  discordUserId:   varchar("discord_user_id", { length: 64 }).notNull(),
  steamId:         varchar("steam_id", { length: 32 }),
  email:           varchar("email", { length: 128 }),
  vipTier:         varchar("vip_tier", { length: 16 }).notNull(),
  amount:          varchar("amount", { length: 16 }).notNull(),
  method:          varchar("method", { length: 16 }),                    // pix | credit_card
  status:          varchar("status", { length: 16 }).notNull().default("pending"),
  ticketChannelId: varchar("ticket_channel_id", { length: 64 }),
  createdAt:       timestamp("created_at").defaultNow().notNull(),
  updatedAt:       timestamp("updated_at").defaultNow().notNull(),
});

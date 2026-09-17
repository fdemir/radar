import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { user, session } from "./auth";
import { run } from "./research";

export const discordConnection = sqliteTable("discord_connection", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => user.id, { onDelete: "cascade" }),
  discordUserId: text("discord_user_id").notNull().unique(),
  username: text("username").notNull(),
  channelId: text("channel_id"),
  status: text("status")
    .$type<"pending" | "ready" | "blocked" | "failed">()
    .notNull()
    .default("pending"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  error: text("error").$type<"no_mutual_guild" | "dm_closed" | "unavailable" | "uncertain">(),
  createdAt: integer("created_at").notNull(),
});

export const discordAuthorization = sqliteTable("discord_authorization", {
  stateHash: text("state_hash").primaryKey(),
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => user.id, { onDelete: "cascade" }),
  sessionId: text("session_id")
    .notNull()
    .references(() => session.id, { onDelete: "cascade" }),
  expiresAt: integer("expires_at").notNull(),
  consumed: integer("consumed", { mode: "boolean" }).notNull().default(false),
});

export const discordDelivery = sqliteTable(
  "discord_delivery",
  {
    id: text("id").primaryKey(),
    connectionId: text("connection_id")
      .notNull()
      .references(() => discordConnection.id, { onDelete: "cascade" }),
    runId: text("run_id").references(() => run.id, { onDelete: "cascade" }),
    kind: text("kind").$type<"welcome" | "test" | "findings">().notNull(),
    status: text("status")
      .$type<"pending" | "sending" | "sent" | "cancelled" | "failed" | "uncertain">()
      .notNull()
      .default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttempt: integer("next_attempt").notNull(),
    messageId: text("message_id"),
    sentAt: integer("sent_at"),
    read: integer("read", { mode: "boolean" }).notNull().default(false),
  },
  (table) => [
    uniqueIndex("discord_delivery_run_idx").on(table.runId, table.connectionId),
    index("discord_delivery_due_idx").on(table.status, table.nextAttempt),
  ],
);

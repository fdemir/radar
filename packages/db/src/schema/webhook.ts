import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { user } from "./auth";
import { run } from "./research";

export const webhookConnection = sqliteTable("webhook_connection", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => user.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  secret: text("secret").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
  verifiedAt: integer("verified_at"),
  createdAt: integer("created_at").notNull(),
});

export const webhookDelivery = sqliteTable(
  "webhook_delivery",
  {
    id: text("id").primaryKey(),
    connectionId: text("connection_id")
      .notNull()
      .references(() => webhookConnection.id, { onDelete: "cascade" }),
    runId: text("run_id").references(() => run.id, { onDelete: "cascade" }),
    kind: text("kind").$type<"test" | "findings">().notNull(),
    payload: text("payload"),
    status: text("status")
      .$type<"pending" | "sending" | "sent" | "failed" | "cancelled">()
      .notNull()
      .default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lease: text("lease"),
    nextAttempt: integer("next_attempt").notNull(),
    createdAt: integer("created_at").notNull(),
    sentAt: integer("sent_at"),
    error: text("error"),
  },
  (table) => [
    uniqueIndex("webhook_delivery_run_idx").on(table.runId, table.connectionId),
    index("webhook_delivery_due_idx").on(table.status, table.nextAttempt),
  ],
);

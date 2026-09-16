import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { Task } from "@radar/core";
import { user } from "./auth";

export const task = sqliteTable(
  "task",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    brief: text("brief").notNull(),
    category: text("category").$type<Task["category"]>().notNull(),
    status: text("status").$type<Task["status"]>().notNull(),
    frequency: text("frequency").$type<Task["frequency"]>().notNull(),
    time: text("time").notNull(),
    language: text("language").$type<Task["language"]>().notNull(),
    email: integer("email", { mode: "boolean" }).notNull().default(true),
    messages: text("messages", { mode: "json" }).$type<Task["messages"]>().notNull().default([]),
    failures: integer("failures").notNull().default(0),
    revision: integer("revision").notNull().default(0),
    nextRunAt: integer("next_run_at"),
    createdAt: integer("created_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    index("task_user_idx").on(table.userId),
    index("task_schedule_idx").on(table.status, table.nextRunAt),
  ],
);

export const preference = sqliteTable("preference", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  emailEnabled: integer("email_enabled", { mode: "boolean" }).notNull().default(true),
  timezone: text("timezone").notNull().default("UTC"),
  language: text("language").$type<Task["language"]>().notNull().default("English"),
});

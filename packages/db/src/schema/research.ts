import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { Run } from "@radar/core";
import { task } from "./tasks";
import { user } from "./auth";

export const run = sqliteTable("run", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull().references(() => task.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  revision: integer("revision").notNull(),
  started: integer("started").notNull(), finished: integer("finished"),
  stage: integer("stage").notNull().default(0),
  status: text("status").$type<Run["status"]>().notNull().default("running"),
  outcome: text("outcome").$type<Run["outcome"]>().notNull().default("unchanged"),
  summary: text("summary").notNull().default("Queued"),
  findings: integer("findings").notNull().default(0),
  sources: text("sources", { mode: "json" }).$type<string[]>().notNull().default([]),
  lease: text("lease"),
}, (table) => [
  uniqueIndex("run_one_active_idx").on(table.taskId).where(sql`status = 'running'`),
  index("run_user_idx").on(table.userId, table.started), index("run_task_idx").on(table.taskId, table.started),
]);
export const finding = sqliteTable("finding", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull().references(() => task.id, { onDelete: "cascade" }),
  runId: text("run_id").notNull().references(() => run.id, { onDelete: "cascade" }),
  eventKey: text("event_key").notNull(), version: text("version").notNull(),
  title: text("title").notNull(), summary: text("summary").notNull(), reason: text("reason").notNull(),
  url: text("url").notNull(), source: text("source").notNull(),
  date: text("date").notNull(), read: integer("read", { mode: "boolean" }).notNull().default(false),
  saved: integer("saved", { mode: "boolean" }).notNull().default(false),
}, (table) => [uniqueIndex("finding_event_idx").on(table.taskId, table.eventKey, table.version), index("finding_task_idx").on(table.taskId)]);
export const delivery = sqliteTable("delivery", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull().references(() => run.id, { onDelete: "cascade" }),
  taskId: text("task_id").notNull().references(() => task.id, { onDelete: "cascade" }),
  target: text("target").notNull(),
  status: text("status").$type<"pending" | "sending" | "sent" | "cancelled" | "failed">().notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  nextAttempt: integer("next_attempt").notNull(), sentAt: integer("sent_at"),
  read: integer("read", { mode: "boolean" }).notNull().default(false),
}, (table) => [uniqueIndex("delivery_run_target_idx").on(table.runId, table.target), index("delivery_due_idx").on(table.status, table.nextAttempt)]);
export const usage = sqliteTable("usage", {
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  day: text("day").notNull(), checks: integer("checks").notNull().default(0),
}, (table) => [primaryKey({ columns: [table.userId, table.day] })]);

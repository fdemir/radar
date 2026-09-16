import { and, desc, eq } from "drizzle-orm";
import { dayKey, type PreferencesInput, type TaskInput, type Workspace } from "@radar/core";
import type { Database } from "./index";
import { user } from "./schema/auth";
import { preference, task } from "./schema/tasks";

export class WorkspaceError extends Error {
  constructor(message: string, public readonly status: 404 | 409 = 409) { super(message); }
}

export function createWorkspace(db: Database) {
  async function account(userId: string) {
    const result = await db.select().from(user).where(eq(user.id, userId)).get();
    if (!result) throw new WorkspaceError("Account not found.", 404);
    return result;
  }
  async function getTask(userId: string, id: string) {
    const result = await db.select().from(task).where(and(eq(task.userId, userId), eq(task.id, id))).get();
    if (!result) throw new WorkspaceError("Task not found.", 404);
    return result;
  }
  async function snapshot(userId: string): Promise<Workspace> {
    const [owner, settings, tasks] = await Promise.all([
      account(userId),
      db.select().from(preference).where(eq(preference.userId, userId)).get(),
      db.select().from(task).where(eq(task.userId, userId)).orderBy(desc(task.createdAt)),
    ]);
    const timezone = settings?.timezone ?? "UTC";
    return {
      tasks: tasks.map(({ userId: _owner, nextRunAt: _next, createdAt: _created, updatedAt: _updated, ...item }) => item),
      findings: [], runs: [], notices: [], checks: 0, day: dayKey(timezone),
      preferences: {
        name: owner.name, email: owner.email, verified: owner.emailVerified,
        emailEnabled: settings?.emailEnabled ?? true, timezone, language: settings?.language ?? "English",
      },
    };
  }
  async function limitGuard<T>(write: () => Promise<T>) {
    try { return await write(); }
    catch (error) {
      // D1 wraps SQLite errors in a cause, while other adapters use the message.
      const detail = error instanceof Error ? `${error.message} ${String(error.cause ?? "")}` : "";
      if (detail.includes("active_task_limit")) throw new WorkspaceError("5 active tasks maximum. Pause a task first.");
      throw error;
    }
  }
  return {
    snapshot,
    getTask,
    async create(userId: string, input: TaskInput) {
      const id = crypto.randomUUID();
      await limitGuard(() => db.insert(task).values({
        ...input, id, userId, revision: 0, title: input.title || "Untitled task",
        nextRunAt: input.status === "active" ? Date.now() : null,
      }).run());
      return getTask(userId, id);
    },
    async update(userId: string, id: string, input: TaskInput) {
      await getTask(userId, id);
      const result = await limitGuard(() => db.update(task).set({
        ...input, revision: input.revision + 1, failures: 0, updatedAt: Date.now(),
        title: input.title || "Untitled task", nextRunAt: input.status === "active" ? Date.now() : null,
      }).where(and(eq(task.id, id), eq(task.userId, userId), eq(task.revision, input.revision))).returning());
      if (!result.length) throw new WorkspaceError("This task changed in another tab. Reload and try again.");
      return result[0]!;
    },
    async remove(userId: string, id: string) {
      await getTask(userId, id);
      await db.delete(task).where(and(eq(task.id, id), eq(task.userId, userId)));
    },
    async preferences(userId: string, input: PreferencesInput) {
      const { name, ...settings } = input;
      const save = db.insert(preference).values({ userId, ...settings }).onConflictDoUpdate({ target: preference.userId, set: Object.keys(settings).length ? settings : { userId } });
      if (Object.keys(settings).length && name !== undefined) {
        await db.batch([save, db.update(user).set({ name }).where(eq(user.id, userId))]);
      } else if (Object.keys(settings).length) { await save; }
      else if (name !== undefined) { await db.update(user).set({ name }).where(eq(user.id, userId)); }
    },
  };
}

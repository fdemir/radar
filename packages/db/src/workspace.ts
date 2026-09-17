import { and, desc, eq, getTableColumns, inArray } from "drizzle-orm";
import { dayKey, type PreferencesInput, type TaskInput, type Workspace } from "@radar/core";
import { nextRunAt } from "@radar/core/schedule";
import type { Database } from "./index";
import { delivery, finding, run, usage } from "./schema/research";
import { user } from "./schema/auth";
import { discordDelivery, discordConnection } from "./schema/discord";
import { preference, task } from "./schema/tasks";

export class WorkspaceError extends Error {
  constructor(
    message: string,
    public readonly status: 404 | 409 = 409,
  ) {
    super(message);
  }
}

export function createWorkspace(db: Database) {
  async function account(userId: string) {
    const result = await db.select().from(user).where(eq(user.id, userId)).get();

    if (!result) throw new WorkspaceError("Account not found.", 404);

    return result;
  }

  async function getTask(userId: string, id: string) {
    const result = await db
      .select()
      .from(task)
      .where(and(eq(task.userId, userId), eq(task.id, id)))
      .get();

    if (!result) throw new WorkspaceError("Task not found.", 404);

    return result;
  }

  async function snapshot(userId: string): Promise<Workspace> {
    const [owner, settings, tasks, findings, runs, deliveries, discordDeliveries, checks] =
      await Promise.all([
        account(userId),
        db.select().from(preference).where(eq(preference.userId, userId)).get(),
        db.select().from(task).where(eq(task.userId, userId)).orderBy(desc(task.createdAt)),
        db
          .select({ ...getTableColumns(finding), category: task.category })
          .from(finding)
          .innerJoin(task, eq(task.id, finding.taskId))
          .where(eq(task.userId, userId))
          .orderBy(desc(finding.date)),
        db.select().from(run).where(eq(run.userId, userId)).orderBy(desc(run.started)),
        db
          .select({ ...getTableColumns(delivery) })
          .from(delivery)
          .innerJoin(task, eq(task.id, delivery.taskId))
          .where(and(eq(task.userId, userId), eq(delivery.status, "sent")))
          .orderBy(desc(delivery.sentAt)),
        db
          .select({ ...getTableColumns(discordDelivery) })
          .from(discordDelivery)
          .innerJoin(discordConnection, eq(discordConnection.id, discordDelivery.connectionId))
          .where(and(eq(discordConnection.userId, userId), eq(discordDelivery.status, "sent")))
          .orderBy(desc(discordDelivery.sentAt)),
        db
          .select()
          .from(usage)
          .where(and(eq(usage.userId, userId), eq(usage.day, dayKey("UTC"))))
          .get(),
      ]);
    const timezone = settings?.timezone ?? "UTC";

    return {
      tasks: tasks.map(
        ({ userId: _owner, createdAt: _created, updatedAt: _updated, ...item }) => item,
      ),
      emailAvailable: false,
      researchAvailable: false,
      findings: findings.map(
        ({ runId: _run, eventKey: _event, version: _version, ...item }) => item,
      ),
      runs: runs.map(({ userId: _user, revision: _revision, lease: _lease, ...item }) => item),
      notices: [
        ...deliveries.map((item) => ({ ...item, channel: "Email" as const })),
        ...discordDeliveries
          .filter((item) => item.runId)
          .map((item) => ({ ...item, channel: "Discord" as const })),
      ]
        .sort((a, b) => (b.sentAt ?? 0) - (a.sentAt ?? 0))
        .flatMap((item) => {
          const first = findings.find((finding) => finding.runId === item.runId);

          return first
            ? [
                {
                  id: item.id,
                  taskId: first.taskId,
                  findingId: first.id,
                  channel: item.channel,
                  date: new Date(item.sentAt!).toISOString(),
                  read: item.read,
                },
              ]
            : [];
        }),
      checks: checks?.checks ?? 0,
      day: dayKey("UTC"),
      preferences: {
        name: owner.name,
        email: owner.email,
        verified: owner.emailVerified,
        emailEnabled: settings?.emailEnabled ?? true,
        timezone,
        language: settings?.language ?? "English",
      },
    };
  }

  async function limitGuard<T>(write: () => Promise<T>) {
    try {
      return await write();
    } catch (error) {
      // D1 wraps SQLite errors in a cause, while other adapters use the message.
      const detail = error instanceof Error ? `${error.message} ${String(error.cause ?? "")}` : "";

      if (detail.includes("active_task_limit"))
        throw new WorkspaceError("5 active tasks maximum. Pause a task first.");

      throw error;
    }
  }

  return {
    snapshot,
    getTask,
    async create(userId: string, input: TaskInput) {
      const id = crypto.randomUUID();

      await limitGuard(() =>
        db
          .insert(task)
          .values({
            ...input,
            id,
            userId,
            revision: 0,
            title: input.title || "Untitled task",
            nextRunAt: input.status === "active" ? Date.now() : null,
          })
          .run(),
      );

      return getTask(userId, id);
    },
    async update(userId: string, id: string, input: TaskInput) {
      await getTask(userId, id);

      const result = await limitGuard(() =>
        db
          .update(task)
          .set({
            ...input,
            revision: input.revision + 1,
            failures: 0,
            updatedAt: Date.now(),
            title: input.title || "Untitled task",
            nextRunAt: input.status === "active" ? Date.now() : null,
          })
          .where(and(eq(task.id, id), eq(task.userId, userId), eq(task.revision, input.revision)))
          .returning(),
      );

      if (!result.length)
        throw new WorkspaceError("This task changed in another tab. Reload and try again.");

      return result[0]!;
    },
    async remove(userId: string, id: string) {
      await getTask(userId, id);
      await db.delete(task).where(and(eq(task.id, id), eq(task.userId, userId)));
    },
    async preferences(userId: string, input: PreferencesInput) {
      const { name, ...settings } = input;

      if (!Object.keys(settings).length) {
        if (name !== undefined) await db.update(user).set({ name }).where(eq(user.id, userId));

        return;
      }

      const save = db
        .insert(preference)
        .values({ userId, ...settings })
        .onConflictDoUpdate({ target: preference.userId, set: settings });
      const current = await db.select().from(preference).where(eq(preference.userId, userId)).get();
      const active =
        input.timezone !== undefined && input.timezone !== (current?.timezone ?? "UTC")
          ? await db
              .select()
              .from(task)
              .where(and(eq(task.userId, userId), eq(task.status, "active")))
          : [];

      await db.batch([
        save,
        ...active.map((item) =>
          db
            .update(task)
            .set({ nextRunAt: nextRunAt(item.frequency, item.time, input.timezone!, Date.now()) })
            .where(
              and(
                eq(task.id, item.id),
                eq(task.revision, item.revision),
                eq(task.status, "active"),
              ),
            ),
        ),
        ...(input.emailEnabled === false
          ? [
              db
                .update(delivery)
                .set({ status: "cancelled" })
                .where(
                  and(
                    inArray(
                      delivery.taskId,
                      db.select({ id: task.id }).from(task).where(eq(task.userId, userId)),
                    ),
                    inArray(delivery.status, ["pending", "sending"]),
                  ),
                ),
            ]
          : []),
        ...(name !== undefined ? [db.update(user).set({ name }).where(eq(user.id, userId))] : []),
      ]);
    },
  };
}

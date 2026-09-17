import { and, desc, eq } from "drizzle-orm";
import { dayKey } from "@radar/core";
import type { ResearchResult } from "@radar/core/research";
import { nextRunAt } from "@radar/core/schedule";
import type { Database } from "./index";
import { finding, run } from "./schema/research";
import { preference } from "./schema/tasks";
import { createWorkspace, WorkspaceError } from "./workspace";

export function createResearch(db: Database) {
  const raw = db.$client;
  const workspace = createWorkspace(db);

  async function start(userId: string, taskId: string, now = Date.now()) {
    const current = await workspace.getTask(userId, taskId);
    const settings = await db.select().from(preference).where(eq(preference.userId, userId)).get();
    const id = crypto.randomUUID();
    const next = nextRunAt(current.frequency, current.time, settings?.timezone ?? "UTC", now);

    try {
      await raw.batch([
        raw
          .prepare(
            "INSERT INTO run (id, task_id, user_id, revision, started) VALUES (?, ?, ?, ?, ?)",
          )
          .bind(id, taskId, userId, current.revision, now),
        raw
          .prepare(
            "UPDATE task SET next_run_at = ? WHERE id = ? AND (next_run_at IS NULL OR next_run_at <= ?)",
          )
          .bind(next, taskId, now),
      ]);
    } catch (error) {
      const detail = error instanceof Error ? `${error.message} ${String(error.cause ?? "")}` : "";

      if (/daily_run_limit/.test(detail))
        throw new WorkspaceError("Daily limit reached: 30 checks.");

      if (/run_cooldown/.test(detail)) throw new WorkspaceError("Wait 10 seconds between checks.");

      if (/task_not_active|task_changed/.test(detail))
        throw new WorkspaceError("Task changed. Reload and try again.");

      if (/UNIQUE constraint failed: run.task_id/.test(detail))
        throw new WorkspaceError("This task is already running.");

      throw error;
    }

    return id;
  }

  async function claim(id: string) {
    const lease = crypto.randomUUID();
    const claimed = await db
      .update(run)
      .set({ stage: 1, lease, summary: "Searching" })
      .where(and(eq(run.id, id), eq(run.status, "running"), eq(run.stage, 0)))
      .returning();

    if (!claimed[0]) return null;

    const row = claimed[0];
    const current = await workspace.getTask(row.userId, row.taskId);
    const previous = await db
      .select()
      .from(finding)
      .where(eq(finding.taskId, row.taskId))
      .orderBy(desc(finding.date))
      .limit(200);

    return { run: row, task: current, previous, lease };
  }

  async function progress(id: string, lease: string, stage: number, sources: string[] = []) {
    const changed = await db
      .update(run)
      .set({ stage, sources })
      .where(and(eq(run.id, id), eq(run.lease, lease), eq(run.status, "running")))
      .returning({ id: run.id });

    return changed.length > 0;
  }

  async function complete(id: string, lease: string, result: ResearchResult, now = Date.now()) {
    const date = new Date(now).toISOString();
    const inserts = result.findings.map((item) =>
      raw
        .prepare(
          `
      INSERT OR IGNORE INTO finding (id, task_id, run_id, event_key, version, title, summary, reason, url, source, date)
      SELECT ?, r.task_id, r.id, ?, ?, ?, ?, ?, ?, ?, ? FROM run r
      WHERE r.id = ? AND r.lease = ? AND r.status = 'completed'
    `,
        )
        .bind(
          crypto.randomUUID(),
          item.eventKey,
          item.version,
          item.title,
          item.summary,
          item.reason,
          item.url,
          new URL(item.url).hostname,
          date,
          id,
          lease,
        ),
    );

    await raw.batch([
      raw
        .prepare(
          "UPDATE run SET status = 'completed', stage = 5, finished = ?, summary = ?, sources = ?, coverage = ? WHERE id = ? AND lease = ? AND status = 'running'",
        )
        .bind(
          now,
          result.summary,
          JSON.stringify(result.sources),
          result.coverage ?? "complete",
          id,
          lease,
        ),
      ...inserts,
      raw
        .prepare(
          `UPDATE run SET findings = (SELECT count(*) FROM finding WHERE run_id = ?),
        outcome = CASE WHEN EXISTS (SELECT 1 FROM finding WHERE run_id = ?) THEN 'new' ELSE 'unchanged' END,
        summary = CASE WHEN EXISTS (SELECT 1 FROM finding WHERE run_id = ?) THEN summary
          WHEN coverage = 'limited' THEN CASE WHEN (SELECT language FROM task WHERE id = task_id) = 'Türkçe' THEN 'Araştırma eksik. Bazı kaynaklar okunamadı veya yeterli kanıt bulunamadı.' ELSE 'Research incomplete. Some sources could not be read or evidence was insufficient.' END
          WHEN (SELECT language FROM task WHERE id = task_id) = 'Türkçe' THEN 'Yeni eşleşme yok.' ELSE 'No new matches.' END
        WHERE id = ? AND lease = ? AND status = 'completed'`,
        )
        .bind(id, id, id, id, lease),
      raw
        .prepare(
          `INSERT OR IGNORE INTO delivery (id, run_id, task_id, target, next_attempt)
        SELECT ?, r.id, t.id, u.email, ? FROM run r JOIN task t ON t.id = r.task_id JOIN user u ON u.id = t.user_id
        LEFT JOIN preference p ON p.user_id = u.id WHERE r.id = ? AND r.lease = ? AND r.status = 'completed'
        AND r.findings > 0 AND t.status = 'active' AND t.email = 1 AND u.email_verified = 1 AND coalesce(p.email_enabled, 1) = 1
      `,
        )
        .bind(crypto.randomUUID(), now, id, lease),
    ]);
  }

  async function fail(id: string, lease: string | null, summary: string, now = Date.now()) {
    const query =
      lease === null
        ? and(eq(run.id, id), eq(run.status, "running"))
        : and(eq(run.id, id), eq(run.lease, lease), eq(run.status, "running"));

    await db
      .update(run)
      .set({ status: "failed", outcome: "error", summary, finished: now })
      .where(query);
  }

  return {
    start,
    claim,
    progress,
    complete,
    fail,
    async checks(userId: string, now = Date.now()) {
      const row = await raw
        .prepare("SELECT checks FROM usage WHERE user_id = ? AND day = ?")
        .bind(userId, dayKey("UTC", now))
        .first<{ checks: number }>();

      return row?.checks ?? 0;
    },
    async due(now = Date.now()) {
      return raw
        .prepare(
          `SELECT t.id, t.user_id AS userId FROM task t WHERE t.status = 'active' AND t.next_run_at <= ?
        AND NOT EXISTS (SELECT 1 FROM run r WHERE r.task_id = t.id AND r.status = 'running')
        AND NOT EXISTS (SELECT 1 FROM usage u WHERE u.user_id = t.user_id AND u.day = ? AND u.checks >= 30)
        ORDER BY t.next_run_at LIMIT 100`,
        )
        .bind(now, dayKey("UTC", now))
        .all<{ id: string; userId: string }>();
    },
    async queued() {
      return db
        .select({ id: run.id })
        .from(run)
        .where(and(eq(run.status, "running"), eq(run.stage, 0)))
        .limit(100);
    },
    async expire(now = Date.now()) {
      await raw
        .prepare(
          "UPDATE run SET status = 'failed', outcome = 'error', summary = 'Research timed out. Try again.', finished = ? WHERE status = 'running' AND started < ?",
        )
        .bind(now, now - 600_000)
        .run();
    },
  };
}

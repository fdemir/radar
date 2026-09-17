import { createAgent, ResearchCancelled, ResearchError, type AgentConfig } from "@radar/agent";
import { createDb } from "@radar/db";
import { createResearch } from "@radar/db/research";
import { WorkspaceError } from "@radar/db/workspace";
import type { ResearchJob } from "@radar/core/research";
import {
  createEmail,
  createDiscord,
  deliverDiscord,
  type DiscordConfig,
  type EmailConfig,
} from "@radar/notifications";

type WorkerEnv = AgentConfig &
  EmailConfig &
  DiscordConfig & { DB: D1Database; RESEARCH_QUEUE: Queue<ResearchJob>; CORS_ORIGIN: string };

async function deliver(env: WorkerEnv) {
  const email = createEmail(env);

  if (!email.available) return;

  const db = env.DB;
  const now = Date.now();

  // A crashed sender can be retried with the same provider idempotency key.
  await db
    .prepare("UPDATE delivery SET status = 'pending' WHERE status = 'sending' AND next_attempt < ?")
    .bind(now - 120_000)
    .run();

  const due = await db
    .prepare(
      `SELECT d.id, d.target, d.run_id AS runId, d.task_id AS taskId, t.title
    FROM delivery d JOIN task t ON t.id = d.task_id JOIN user u ON u.id = t.user_id LEFT JOIN preference p ON p.user_id = u.id
    WHERE d.status = 'pending' AND d.next_attempt <= ? AND t.status = 'active' AND t.email = 1
    AND u.email_verified = 1 AND u.email = d.target AND coalesce(p.email_enabled, 1) = 1 LIMIT 20`,
    )
    .bind(now)
    .all<{ id: string; target: string; runId: string; taskId: string; title: string }>();

  for (const item of due.results) {
    const claimed = await db
      .prepare(
        `UPDATE delivery SET status = 'sending', attempts = attempts + 1, next_attempt = ?
      WHERE id = ? AND status = 'pending' AND EXISTS (SELECT 1 FROM task t JOIN user u ON u.id = t.user_id
        LEFT JOIN preference p ON p.user_id = u.id WHERE t.id = delivery.task_id AND t.status = 'active' AND t.email = 1
        AND u.email_verified = 1 AND u.email = delivery.target AND coalesce(p.email_enabled, 1) = 1)
      RETURNING attempts`,
      )
      .bind(now, item.id)
      .first<{ attempts: number }>();

    if (!claimed) continue;

    try {
      const findings = await db
        .prepare("SELECT title, summary, url FROM finding WHERE run_id = ?")
        .bind(item.runId)
        .all<{ title: string; summary: string; url: string }>();

      if (!findings.results.length) {
        await db
          .prepare("UPDATE delivery SET status = 'cancelled' WHERE id = ? AND status = 'sending'")
          .bind(item.id)
          .run();
        continue;
      }

      const text =
        findings.results
          .map((finding) => `${finding.title}\n${finding.summary}\n${finding.url}`)
          .join("\n\n") + `\n\n${env.CORS_ORIGIN}/tasks/${item.taskId}`;
      // Recheck after the content read so pause/delete can cancel queued mail.
      const active = await db
        .prepare(
          `SELECT d.id FROM delivery d JOIN task t ON t.id = d.task_id JOIN user u ON u.id = t.user_id
        LEFT JOIN preference p ON p.user_id = u.id WHERE d.id = ? AND d.status = 'sending' AND t.status = 'active'
        AND t.email = 1 AND u.email_verified = 1 AND u.email = d.target AND coalesce(p.email_enabled, 1) = 1`,
        )
        .bind(item.id)
        .first();

      if (!active) continue;

      await email.send(
        item.target,
        `${item.title}: ${findings.results.length} new findings`,
        text,
        `radar-${item.runId}-${item.id}`,
      );
      await db
        .prepare(
          "UPDATE delivery SET status = 'sent', sent_at = ? WHERE id = ? AND status = 'sending'",
        )
        .bind(Date.now(), item.id)
        .run();
    } catch {
      await db
        .prepare(
          "UPDATE delivery SET status = ?, next_attempt = ? WHERE id = ? AND status = 'sending'",
        )
        .bind(
          claimed.attempts >= 5 ? "failed" : "pending",
          now + Math.min(3_600_000, 60_000 * 2 ** claimed.attempts),
          item.id,
        )
        .run();
    }
  }
}

export default {
  async fetch() {
    return new Response("Not found", { status: 404 });
  },
  async scheduled(_controller: ScheduledController, env: WorkerEnv) {
    const research = createResearch(createDb(env));

    await research.expire();

    if (env.OPENAI_API_KEY && env.TINYFISH_API_KEY) {
      for (const task of (await research.due()).results) {
        try {
          await research.start(task.userId, task.id);
        } catch (error) {
          if (!(error instanceof WorkspaceError)) throw error;
        }
      }

      // Repairs the gap between a committed run and queue publishing.
      for (const run of await research.queued()) await env.RESEARCH_QUEUE.send({ runId: run.id });
    }

    await deliverDiscord(createDb(env), createDiscord(env), env.CORS_ORIGIN);
    await deliver(env);
  },
  async queue(batch: MessageBatch<ResearchJob>, env: WorkerEnv) {
    const research = createResearch(createDb(env));

    for (const message of batch.messages) {
      const claimed = await research.claim(message.body.runId);

      if (!claimed) {
        message.ack();
        continue;
      }

      try {
        const result = await createAgent(env).research(
          claimed.task,
          claimed.previous,
          (stage, sources) => research.progress(claimed.run.id, claimed.lease, stage, sources),
        );

        await research.complete(claimed.run.id, claimed.lease, result);
      } catch (error) {
        if (!(error instanceof ResearchCancelled)) {
          await research.fail(
            claimed.run.id,
            claimed.lease,
            error instanceof ResearchError
              ? error.message
              : "Research could not finish. Try again.",
          );
        }
      }

      message.ack();
    }

    await deliverDiscord(createDb(env), createDiscord(env), env.CORS_ORIGIN);
    await deliver(env);
  },
} satisfies ExportedHandler<WorkerEnv, ResearchJob>;

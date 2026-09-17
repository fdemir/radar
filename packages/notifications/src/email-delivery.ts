import type { Database } from "@radar/db";
import type { createEmail } from "./index";
import { emailFindings, findingSubject } from "./finding-message";

const RETRY_WINDOW_MS = 24 * 60 * 60 * 1000 - 60_000;

export async function deliverEmail(
  database: Database,
  email: ReturnType<typeof createEmail>,
  origin: string,
) {
  if (!email.available) return;

  const db = database.$client;
  const now = Date.now();

  // Resend retains keys for 24 hours. Stop a minute early to cover request latency.
  // Legacy attempted rows have no reliable first-attempt timestamp: do not resend.
  await db
    .prepare(
      `UPDATE delivery SET status = 'uncertain', lease = NULL
    WHERE status IN ('pending', 'sending') AND
      ((attempts > 0 AND first_attempt_at IS NULL) OR first_attempt_at <= ?)`,
    )
    .bind(now - RETRY_WINDOW_MS)
    .run();

  // Recover abandoned claims only while provider deduplication still protects them.
  await db
    .prepare(
      "UPDATE delivery SET status = CASE WHEN attempts >= 5 THEN 'uncertain' ELSE 'pending' END, lease = NULL WHERE status = 'sending' AND next_attempt < ?",
    )
    .bind(now - 120_000)
    .run();

  const due = await db
    .prepare(
      `SELECT d.id, d.target, d.run_id AS runId, d.task_id AS taskId, t.language
    FROM delivery d JOIN task t ON t.id = d.task_id JOIN user u ON u.id = t.user_id LEFT JOIN preference p ON p.user_id = u.id
    WHERE d.status = 'pending' AND d.next_attempt <= ? AND t.status = 'active'
    AND u.email_verified = 1 AND u.email = d.target AND coalesce(p.email_enabled, 1) = 1 ORDER BY d.next_attempt, d.id LIMIT 20`,
    )
    .bind(now)
    .all<{ id: string; target: string; runId: string; taskId: string; language: string }>();

  for (const item of due.results) {
    const claimedAt = Date.now();
    const lease = crypto.randomUUID();

    const claimed = await db
      .prepare(
        `UPDATE delivery SET status = 'sending', attempts = attempts + 1, next_attempt = ?,
        first_attempt_at = coalesce(first_attempt_at, ?), lease = ?
      WHERE id = ? AND status = 'pending' AND next_attempt <= ? AND attempts < 5
        AND (first_attempt_at > ? OR (first_attempt_at IS NULL AND attempts = 0)) AND EXISTS (SELECT 1 FROM task t JOIN user u ON u.id = t.user_id
        LEFT JOIN preference p ON p.user_id = u.id WHERE t.id = delivery.task_id AND t.status = 'active'
        AND u.email_verified = 1 AND u.email = delivery.target AND coalesce(p.email_enabled, 1) = 1)
      RETURNING attempts`,
      )
      .bind(claimedAt, claimedAt, lease, item.id, claimedAt, claimedAt - RETRY_WINDOW_MS)
      .first<{ attempts: number }>();

    if (!claimed) continue;

    try {
      const findings = await db
        .prepare("SELECT title, summary, url FROM finding WHERE run_id = ? ORDER BY rowid")
        .bind(item.runId)
        .all<{ title: string; summary: string; url: string }>();

      if (!findings.results.length) {
        await db
          .prepare(
            "UPDATE delivery SET status = 'cancelled' WHERE id = ? AND status = 'sending' AND lease = ?",
          )
          .bind(item.id, lease)
          .run();
        continue;
      }

      const { text, html } = emailFindings(
        findings.results,
        `${origin}/tasks/${item.taskId}`,
        item.language,
      );
      // Recheck after the content read so pause/delete can cancel queued mail.
      const active = await db
        .prepare(
          `SELECT d.id FROM delivery d JOIN task t ON t.id = d.task_id JOIN user u ON u.id = t.user_id
        LEFT JOIN preference p ON p.user_id = u.id WHERE d.id = ? AND d.status = 'sending' AND d.lease = ?
        AND d.first_attempt_at > ? AND t.status = 'active'
        AND u.email_verified = 1 AND u.email = d.target AND coalesce(p.email_enabled, 1) = 1`,
        )
        .bind(item.id, lease, Date.now() - RETRY_WINDOW_MS)
        .first();

      if (!active) continue;

      await email.send(
        item.target,
        findingSubject(findings.results),
        text,
        `radar-${item.runId}-${item.id}`,
        html,
      );
      await db
        .prepare(
          "UPDATE delivery SET status = 'sent', sent_at = ? WHERE id = ? AND status = 'sending' AND lease = ?",
        )
        .bind(Date.now(), item.id, lease)
        .run();
    } catch {
      await db
        .prepare(
          "UPDATE delivery SET status = ?, next_attempt = ? WHERE id = ? AND status = 'sending' AND lease = ?",
        )
        .bind(
          claimed.attempts >= 5 ? "failed" : "pending",
          Date.now() + Math.min(3_600_000, 60_000 * 2 ** claimed.attempts),
          item.id,
          lease,
        )
        .run();
    }
  }
}

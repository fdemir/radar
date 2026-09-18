import type { Database } from "@radar/db";
import { webhookUrlSchema } from "@radar/core/webhook";

export async function webhookSignature(secret: string, timestamp: string, payload: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${timestamp}.${payload}`),
  );

  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

// Delivery is at-least-once. Receivers must deduplicate using the stable event ID.
export async function deliverWebhooks(
  db: Database,
  origin: string,
  connectionId: string | null = null,
) {
  const raw = db.$client;
  const now = Date.now();
  const eligible = `EXISTS (SELECT 1 FROM webhook_connection c WHERE c.id = webhook_delivery.connection_id
    AND (webhook_delivery.kind = 'test' OR (c.enabled = 1 AND c.verified_at IS NOT NULL AND EXISTS
      (SELECT 1 FROM run r JOIN task t ON t.id = r.task_id WHERE r.id = webhook_delivery.run_id
        AND r.status = 'completed' AND t.status = 'active' AND t.revision = r.revision))))`;

  await raw
    .prepare(
      `UPDATE webhook_delivery SET status = CASE WHEN attempts < 5 THEN 'pending' ELSE 'failed' END,
    lease = NULL, error = 'Delivery interrupted' WHERE status = 'sending' AND next_attempt <= ?`,
    )
    .bind(now)
    .run();

  const due = await raw
    .prepare(
      `SELECT id FROM webhook_delivery WHERE status = 'pending' AND next_attempt <= ?
    AND (? IS NULL OR connection_id = ?) AND ${eligible} ORDER BY next_attempt LIMIT 10`,
    )
    .bind(now, connectionId, connectionId)
    .all<{ id: string }>();

  for (const { id } of due.results) {
    const lease = crypto.randomUUID();
    const claimed = await raw
      .prepare(
        `UPDATE webhook_delivery SET status = 'sending', lease = ?, attempts = attempts + 1, next_attempt = ?
      WHERE id = ? AND status = 'pending' AND next_attempt <= ? AND ${eligible}
      AND NOT EXISTS (SELECT 1 FROM webhook_delivery active WHERE active.connection_id = webhook_delivery.connection_id AND active.status = 'sending')
      RETURNING connection_id AS connectionId, run_id AS runId, kind, payload, attempts, created_at AS createdAt`,
      )
      .bind(lease, Date.now() + 120_000, id, Date.now())
      .first<{
        connectionId: string;
        runId: string | null;
        kind: string;
        payload: string | null;
        attempts: number;
        createdAt: number;
      }>();

    if (!claimed) continue;

    let retry = true;
    let retryAt = Date.now() + 60_000 * 2 ** (claimed.attempts - 1);
    let error = "Endpoint did not respond";

    try {
      const connection = await raw
        .prepare("SELECT url, secret FROM webhook_connection WHERE id = ?")
        .bind(claimed.connectionId)
        .first<{ url: string; secret: string }>();

      if (!connection) continue;

      if (!webhookUrlSchema.safeParse(connection.url).success) {
        retry = false;
        throw new Error("Invalid endpoint");
      }

      let payload = claimed.payload;

      if (!payload) {
        let data: unknown = { message: "Your Radar webhook is connected." };

        if (claimed.runId) {
          const task = await raw
            .prepare(
              "SELECT t.id, t.title FROM task t JOIN run r ON r.task_id = t.id WHERE r.id = ?",
            )
            .bind(claimed.runId)
            .first<{ id: string; title: string }>();
          const findings = await raw
            .prepare(
              "SELECT id, title, summary, reason, evidence, url, source, date FROM finding WHERE run_id = ? ORDER BY rowid",
            )
            .bind(claimed.runId)
            .all();

          if (!task || !findings.results.length) {
            await raw
              .prepare(
                "UPDATE webhook_delivery SET status = 'cancelled', lease = NULL WHERE id = ? AND lease = ?",
              )
              .bind(id, lease)
              .run();
            continue;
          }

          data = {
            task: { ...task, url: `${origin}/tasks/${task.id}` },
            runId: claimed.runId,
            findings: findings.results,
          };
        }

        payload = JSON.stringify({
          id,
          type: claimed.kind === "test" ? "webhook.test" : "findings.created",
          version: 1,
          createdAt: new Date(claimed.createdAt).toISOString(),
          data,
        });
        await raw
          .prepare(
            "UPDATE webhook_delivery SET payload = ? WHERE id = ? AND lease = ? AND status = 'sending'",
          )
          .bind(payload, id, lease)
          .run();
      }

      const timestamp = String(Math.floor(Date.now() / 1000));
      const signature = await webhookSignature(connection.secret, timestamp, payload);

      // Check again after asynchronous work, in case the user paused or replaced it.
      if (
        !(await raw
          .prepare(
            `SELECT id FROM webhook_delivery WHERE id = ? AND lease = ? AND status = 'sending' AND ${eligible}`,
          )
          .bind(id, lease)
          .first())
      )
        continue;

      const response = await fetch(connection.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Webhook-Id": id,
          "Webhook-Timestamp": timestamp,
          "Webhook-Signature": `v1=${signature}`,
        },
        body: payload,
        redirect: "manual",
        signal: AbortSignal.timeout(10_000),
      });

      // Never store response bodies: they may contain secrets or be arbitrarily large.
      await response.body?.cancel();

      if (response.ok) {
        await raw.batch([
          raw
            .prepare(
              "UPDATE webhook_delivery SET status = 'sent', sent_at = ?, error = NULL WHERE id = ? AND lease = ? AND status = 'sending'",
            )
            .bind(Date.now(), id, lease),
          raw
            .prepare(
              `UPDATE webhook_connection SET enabled = CASE WHEN verified_at IS NULL THEN 1 ELSE enabled END, verified_at = ?
            WHERE id = ? AND EXISTS (SELECT 1 FROM webhook_delivery WHERE id = ? AND lease = ? AND status = 'sent' AND kind = 'test')`,
            )
            .bind(Date.now(), claimed.connectionId, id, lease),
        ]);
        continue;
      }

      error = `Endpoint returned HTTP ${response.status}`;
      retry = response.status === 408 || response.status === 429 || response.status >= 500;

      const retryAfter = response.headers.get("Retry-After");
      const delay =
        retryAfter && /^\d+$/.test(retryAfter)
          ? Number(retryAfter) * 1000
          : retryAfter
            ? Date.parse(retryAfter) - Date.now()
            : 0;

      if (Number.isFinite(delay) && delay > 0)
        retryAt = Math.max(retryAt, Date.now() + Math.min(delay, 86_400_000));
    } catch {
      // Keep URLs, signing keys, and raw provider errors out of diagnostics.
    }

    await raw
      .prepare(
        "UPDATE webhook_delivery SET status = ?, next_attempt = ?, error = ?, lease = NULL WHERE id = ? AND lease = ? AND status = 'sending'",
      )
      .bind(retry && claimed.attempts < 5 ? "pending" : "failed", retryAt, error, id, lease)
      .run();
  }
}

import type { Database } from "@radar/db";
import { DiscordError, type Discord } from "./discord";
import { discordFindings } from "./finding-message";

// Never automatically resend an ambiguous message POST: Discord nonce deduplication
// only lasts a few minutes, so it cannot protect retries after a long outage.
export async function deliverDiscord(
  db: Database,
  discord: Discord,
  origin: string,
  connectionId: string | null = null,
) {
  if (!discord.canSend) return;

  const raw = db.$client;
  const now = Date.now();

  const cooldown = await raw
    .prepare("SELECT last_request FROM rate_limit WHERE key = 'discord:delivery'")
    .first<number>("last_request");

  if (cooldown && cooldown > now) return;

  await raw.batch([
    raw
      .prepare(
        `UPDATE discord_connection SET status = 'failed', error = 'uncertain' WHERE id IN
      (SELECT connection_id FROM discord_delivery WHERE status = 'sending' AND next_attempt < ? )`,
      )
      .bind(now - 120_000),
    raw
      .prepare(
        "UPDATE discord_delivery SET status = 'uncertain' WHERE status = 'sending' AND next_attempt < ?",
      )
      .bind(now - 120_000),
  ]);

  const eligible = `EXISTS (SELECT 1 FROM discord_connection c WHERE c.id = discord_delivery.connection_id
    AND (discord_delivery.kind != 'findings' OR (c.status = 'ready' AND c.enabled = 1 AND EXISTS
      (SELECT 1 FROM run r JOIN task t ON t.id = r.task_id WHERE r.id = discord_delivery.run_id
        AND r.status = 'completed' AND t.status = 'active' AND t.revision = r.revision))))`;
  const due = await raw
    .prepare(
      `SELECT id FROM discord_delivery WHERE status = 'pending' AND next_attempt <= ? AND (? IS NULL OR connection_id = ?) AND ${eligible} ORDER BY next_attempt LIMIT 20`,
    )
    .bind(now, connectionId, connectionId)
    .all<{ id: string }>();

  for (const { id } of due.results) {
    const claimed = await raw
      .prepare(
        `UPDATE discord_delivery SET status = 'sending', attempts = attempts + 1, next_attempt = ? WHERE id = ? AND status = 'pending' AND NOT EXISTS (SELECT 1 FROM discord_delivery active WHERE active.connection_id = discord_delivery.connection_id AND active.status = 'sending') AND ${eligible} RETURNING connection_id AS connectionId, run_id AS runId, kind, attempts`,
      )
      .bind(Date.now(), id)
      .first<{ connectionId: string; runId: string | null; kind: string; attempts: number }>();

    if (!claimed) continue;

    try {
      const connection = await raw
        .prepare(
          "SELECT discord_user_id AS userId, channel_id AS channelId, enabled FROM discord_connection WHERE id = ?",
        )
        .bind(claimed.connectionId)
        .first<{ userId: string; channelId: string | null; enabled: number }>();

      if (!connection) continue;

      let content =
        claimed.kind === "welcome"
          ? `Your Radar account is connected ✅\n${connection.enabled ? "I'll send new findings from your active tasks here." : "Discord notifications are currently paused."}\n\nManage notifications: ${origin}/settings`
          : `Your Radar test message arrived ✅\nManage notifications: ${origin}/settings`;

      if (claimed.runId) {
        const findings = await raw
          .prepare(
            "SELECT f.title, f.summary, f.url, t.id AS taskId, t.language FROM finding f JOIN task t ON t.id = f.task_id WHERE f.run_id = ? ORDER BY f.rowid LIMIT 5",
          )
          .bind(claimed.runId)
          .all<{
            title: string;
            summary: string;
            url: string;
            taskId: string;
            language: string;
          }>();
        const first = findings.results[0];

        if (!first) {
          await raw
            .prepare(
              "UPDATE discord_delivery SET status = 'cancelled' WHERE id = ? AND status = 'sending'",
            )
            .bind(id)
            .run();
          continue;
        }

        content = discordFindings(
          findings.results,
          `${origin}/tasks/${first.taskId}`,
          first.language,
        );
      }

      const channelId = connection.channelId ?? (await discord.openDm(connection.userId));

      await raw
        .prepare("UPDATE discord_connection SET channel_id = ? WHERE id = ?")
        .bind(channelId, claimed.connectionId)
        .run();

      // Disconnect, pause and task edits can invalidate work while Discord is responding.
      if (
        !(await raw
          .prepare(
            `SELECT id FROM discord_delivery WHERE id = ? AND status = 'sending' AND ${eligible}`,
          )
          .bind(id)
          .first())
      )
        continue;

      const messageId = await discord.send(channelId, content, id.replaceAll("-", "").slice(0, 25));

      await raw.batch([
        raw
          .prepare(
            "UPDATE discord_delivery SET status = 'sent', message_id = ?, sent_at = ? WHERE id = ? AND status = 'sending'",
          )
          .bind(messageId, Date.now(), id),
        raw
          .prepare(
            "UPDATE discord_connection SET status = 'ready', error = NULL WHERE id = ? AND EXISTS (SELECT 1 FROM discord_delivery WHERE id = ? AND status = 'sent')",
          )
          .bind(claimed.connectionId, id),
      ]);
    } catch (error) {
      const failure = error instanceof DiscordError ? error : new DiscordError("uncertain");
      const retry = failure.retryAfter !== undefined && claimed.attempts < 5;

      await raw
        .prepare(
          "UPDATE discord_delivery SET status = ?, next_attempt = ? WHERE id = ? AND status = 'sending'",
        )
        .bind(
          retry ? "pending" : failure.reason === "uncertain" ? "uncertain" : "failed",
          Date.now() + Math.max(failure.retryAfter ?? 0, 1000 * 2 ** claimed.attempts),
          id,
        )
        .run();

      if (!retry) {
        await raw
          .prepare("UPDATE discord_connection SET status = ?, error = ? WHERE id = ?")
          .bind(
            ["no_mutual_guild", "dm_closed"].includes(failure.reason) ? "blocked" : "failed",
            failure.reason,
            claimed.connectionId,
          )
          .run();
      }

      if (failure.retryAfter !== undefined) {
        await raw
          .prepare(
            `INSERT INTO rate_limit (id, key, count, last_request) VALUES (?, 'discord:delivery', 0, ?)
          ON CONFLICT(key) DO UPDATE SET last_request = max(last_request, excluded.last_request)`,
          )
          .bind(crypto.randomUUID(), Date.now() + failure.retryAfter)
          .run();
      }

      // Stop this batch on a rate limit or service failure; don't hammer other recipients.
      if (failure.reason === "unavailable") break;
    }
  }
}

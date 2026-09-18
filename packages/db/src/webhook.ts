import type { Database } from "./index";
import { WorkspaceError } from "./workspace";

export function createWebhookConnections(db: Database) {
  const raw = db.$client;

  return {
    async status(userId: string) {
      const connection = await raw
        .prepare("SELECT id, url, enabled, verified_at FROM webhook_connection WHERE user_id = ?")
        .bind(userId)
        .first<{ id: string; url: string; enabled: number; verified_at: number | null }>();

      if (!connection) return null;

      const lastDelivery = await raw
        .prepare(
          "SELECT status, attempts, error FROM webhook_delivery WHERE connection_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1",
        )
        .bind(connection.id)
        .first<{ status: string; attempts: number; error: string | null }>();

      return {
        url: connection.url,
        enabled: Boolean(connection.enabled),
        verified: connection.verified_at !== null,
        lastDelivery,
      };
    },
    async save(userId: string, url: string) {
      const secret = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");

      // A replacement has its own identity: old deliveries cannot reach the new URL.
      await raw.batch([
        raw.prepare("DELETE FROM webhook_connection WHERE user_id = ?").bind(userId),
        raw
          .prepare(
            "INSERT INTO webhook_connection (id, user_id, url, secret, created_at) VALUES (?, ?, ?, ?, ?)",
          )
          .bind(crypto.randomUUID(), userId, url, secret, Date.now()),
      ]);

      return secret;
    },
    async disconnect(userId: string) {
      await raw.prepare("DELETE FROM webhook_connection WHERE user_id = ?").bind(userId).run();
    },
    async enable(userId: string, enabled: boolean) {
      const changed = await raw
        .prepare(
          "UPDATE webhook_connection SET enabled = ? WHERE user_id = ? AND (? = 0 OR verified_at IS NOT NULL) RETURNING id",
        )
        .bind(Number(enabled), userId, Number(enabled))
        .first();

      if (!changed)
        throw new WorkspaceError("Send a successful test before enabling webhook notifications.");
    },
    async test(userId: string) {
      const id = crypto.randomUUID();
      const now = Date.now();
      const row = await raw
        .prepare(
          `INSERT INTO webhook_delivery (id, connection_id, kind, next_attempt, created_at)
        SELECT ?, id, 'test', ?, ? FROM webhook_connection WHERE user_id = ?
        AND NOT EXISTS (SELECT 1 FROM webhook_delivery d WHERE d.connection_id = webhook_connection.id AND d.kind = 'test' AND d.status IN ('pending', 'sending')) RETURNING connection_id`,
        )
        .bind(id, now, now, userId)
        .first<{ connection_id: string }>();

      if (!row) throw new WorkspaceError("Save a webhook first, or wait for the pending test.");

      return { id, connectionId: row.connection_id };
    },
  };
}

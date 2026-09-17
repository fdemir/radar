import type { Database } from "./index";
import { WorkspaceError } from "./workspace";

export async function hashState(state: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(state));

  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function createDiscordConnections(db: Database) {
  const raw = db.$client;

  return {
    async status(userId: string) {
      const row = await raw
        .prepare(
          `SELECT username, status, enabled, error FROM discord_connection WHERE user_id = ?`,
        )
        .bind(userId)
        .first<{
          username: string;
          status: "pending" | "ready" | "blocked" | "failed";
          enabled: number;
          error: string | null;
        }>();

      return row ? { ...row, enabled: Boolean(row.enabled) } : null;
    },
    async begin(userId: string, sessionId: string) {
      if (
        await raw
          .prepare("SELECT id FROM discord_connection WHERE user_id = ?")
          .bind(userId)
          .first()
      )
        throw new WorkspaceError(
          "Disconnect your current Discord account before connecting another.",
        );

      const state = crypto.randomUUID() + crypto.randomUUID();

      await raw
        .prepare(
          `INSERT INTO discord_authorization (state_hash, user_id, session_id, expires_at, consumed) VALUES (?, ?, ?, ?, 0)
        ON CONFLICT(user_id) DO UPDATE SET state_hash = excluded.state_hash, session_id = excluded.session_id, expires_at = excluded.expires_at, consumed = 0`,
        )
        .bind(await hashState(state), userId, sessionId, Date.now() + 600_000)
        .run();

      return state;
    },
    async consume(state: string, userId: string, sessionId: string) {
      return raw
        .prepare(
          `UPDATE discord_authorization SET consumed = 1 WHERE state_hash = ? AND user_id = ? AND session_id = ? AND expires_at > ? AND consumed = 0 RETURNING state_hash`,
        )
        .bind(await hashState(state), userId, sessionId, Date.now())
        .first();
    },
    async forget(state: string) {
      await raw
        .prepare("DELETE FROM discord_authorization WHERE state_hash = ?")
        .bind(await hashState(state))
        .run();
    },
    async link(state: string, userId: string, profile: { id: string; username: string }) {
      const connectionId = crypto.randomUUID();
      const stateHash = await hashState(state);
      const now = Date.now();

      // The consumed authorization must still exist: disconnect or a newer attempt invalidates it.
      await raw.batch([
        raw
          .prepare(
            `INSERT OR IGNORE INTO discord_connection (id, user_id, discord_user_id, username, created_at)
          SELECT ?, user_id, ?, ?, ? FROM discord_authorization WHERE state_hash = ? AND user_id = ? AND consumed = 1 AND expires_at > ?`,
          )
          .bind(connectionId, profile.id, profile.username, now, stateHash, userId, now),
        raw
          .prepare(
            `INSERT INTO discord_delivery (id, connection_id, kind, next_attempt)
          SELECT ?, id, 'welcome', ? FROM discord_connection WHERE id = ?`,
          )
          .bind(crypto.randomUUID(), now, connectionId),
        raw.prepare("DELETE FROM discord_authorization WHERE state_hash = ?").bind(stateHash),
      ]);

      if (
        !(await raw
          .prepare("SELECT id FROM discord_connection WHERE id = ?")
          .bind(connectionId)
          .first())
      )
        throw new WorkspaceError(
          "This Discord account is already linked or the connection attempt expired.",
        );

      return connectionId;
    },
    async disconnect(userId: string) {
      await raw.batch([
        raw.prepare("DELETE FROM discord_authorization WHERE user_id = ?").bind(userId),
        raw.prepare("DELETE FROM discord_connection WHERE user_id = ?").bind(userId),
      ]);
    },
    async enable(userId: string, enabled: boolean) {
      const changed = await raw
        .prepare(
          "UPDATE discord_connection SET enabled = ? WHERE user_id = ? AND (? = 0 OR status = 'ready') RETURNING id",
        )
        .bind(Number(enabled), userId, Number(enabled))
        .first();

      if (!changed)
        throw new WorkspaceError(
          "Send a successful test message before enabling Discord notifications.",
        );
    },
    async test(userId: string) {
      const connection = await raw
        .prepare("SELECT id FROM discord_connection WHERE user_id = ?")
        .bind(userId)
        .first<{ id: string }>();

      if (!connection) throw new WorkspaceError("Connect your Discord account first.", 404);

      const result = await raw
        .prepare(
          `INSERT INTO discord_delivery (id, connection_id, kind, next_attempt)
        SELECT ?, id, CASE WHEN status = 'ready' THEN 'test' ELSE 'welcome' END, ? FROM discord_connection
        WHERE id = ? AND NOT EXISTS (SELECT 1 FROM discord_delivery WHERE connection_id = ? AND status IN ('pending', 'sending') AND kind != 'findings') RETURNING id`,
        )
        .bind(crypto.randomUUID(), Date.now(), connection.id, connection.id)
        .first();

      if (!result) throw new WorkspaceError("A Discord message is already waiting to be sent.");

      await raw
        .prepare(
          "UPDATE discord_connection SET status = 'pending', error = NULL WHERE id = ? AND status != 'ready'",
        )
        .bind(connection.id)
        .run();

      return { connectionId: connection.id, deliveryId: String(result.id) };
    },
  };
}

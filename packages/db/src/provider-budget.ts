import { ResearchDeferred, type ResearchService } from "@radar/core/research";
import type { Database } from "./index";

const windows = {
  search: [
    { duration: 60_000, limit: 30 },
    { duration: 3_600_000, limit: 500 },
  ],
  fetch: [
    { duration: 60_000, limit: 150 },
    { duration: 86_400_000, limit: 1000 },
  ],
};

// One shared budget for every task using the same provider key. No secrets are stored.
export async function createProviderBudget(db: Database, apiKey: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(apiKey));
  const scope = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const raw = db.$client;

  return {
    async reserve(service: ResearchService, amount: number, now = Date.now()) {
      const [short, long] = windows[service];

      if (!Number.isInteger(amount) || amount < 1 || amount > short!.limit)
        throw new Error("Invalid provider budget reservation.");

      await raw
        .prepare("DELETE FROM provider_usage WHERE created_at <= ?")
        .bind(now - 86_400_000)
        .run();

      // Checking and incrementing in one SQL statement prevents concurrent workers overspending.
      const reserved = await raw
        .prepare(
          `
        INSERT INTO provider_usage (id, scope, service, amount, created_at)
        SELECT ?, ?, ?, ?, ?
        WHERE NOT EXISTS (SELECT 1 FROM provider_backoff WHERE scope = ? AND service = ? AND retry_at > ?)
        AND (SELECT coalesce(sum(amount), 0) FROM provider_usage WHERE scope = ? AND service = ? AND created_at > ?) + ? <= ?
        AND (SELECT coalesce(sum(amount), 0) FROM provider_usage WHERE scope = ? AND service = ? AND created_at > ?) + ? <= ?
        RETURNING id
      `,
        )
        .bind(
          crypto.randomUUID(),
          scope,
          service,
          amount,
          now,
          scope,
          service,
          now,
          scope,
          service,
          now - short!.duration,
          amount,
          short!.limit,
          scope,
          service,
          now - long!.duration,
          amount,
          long!.limit,
        )
        .first();

      if (reserved) return;

      const [usage, backoff] = await Promise.all([
        raw
          .prepare(
            "SELECT amount, created_at AS createdAt FROM provider_usage WHERE scope = ? AND service = ? AND created_at > ? ORDER BY created_at",
          )
          .bind(scope, service, now - long!.duration)
          .all<{ amount: number; createdAt: number }>(),
        raw
          .prepare(
            "SELECT retry_at AS retryAt FROM provider_backoff WHERE scope = ? AND service = ?",
          )
          .bind(scope, service)
          .first<{ retryAt: number }>(),
      ]);
      let retryAt = Math.max(now + 1000, backoff?.retryAt ?? 0);

      for (const window of windows[service]) {
        const entries = usage.results.filter((entry) => entry.createdAt > now - window.duration);
        let total = entries.reduce((sum, entry) => sum + entry.amount, amount);

        for (const entry of entries) {
          if (total <= window.limit) break;

          total -= entry.amount;
          retryAt = Math.max(retryAt, entry.createdAt + window.duration + 1000);
        }
      }

      throw new ResearchDeferred(retryAt);
    },
    async backoff(service: ResearchService, retryAt: number) {
      await raw
        .prepare(
          `INSERT INTO provider_backoff (scope, service, retry_at) VALUES (?, ?, ?)
        ON CONFLICT(scope, service) DO UPDATE SET retry_at = max(retry_at, excluded.retry_at)`,
        )
        .bind(scope, service, retryAt)
        .run();
    },
  };
}

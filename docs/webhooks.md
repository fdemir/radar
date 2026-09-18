# Webhooks

Radar can send new findings to one HTTPS endpoint per account, independently of email and Discord.

## Connect

1. Open **Settings → Notifications → Webhook** and save your public HTTPS endpoint.
2. Copy the signing key into your receiving app. Radar shows it only after saving.
3. Choose **Send test**. A successful 2xx response enables notifications for all active tasks.

Use the switch to pause notifications or **Disconnect** to remove the connection. Saving a URL again replaces the signing key, cancels existing deliveries, and requires another successful test. A test on an already verified, paused connection leaves it paused. Nothing is sent for checks without new findings or for duplicate findings.

Endpoints must use a DNS hostname and HTTPS on port 443, without URL credentials or fragments. IP literals, local names, custom ports, and redirects are rejected. Delivery uses Cloudflare Workers' public `fetch`, with `global_fetch_strictly_public` enabled; do not route it through a private-network binding. See [Cloudflare's fetch documentation](https://developers.cloudflare.com/workers/runtime-apis/fetch/). Local development should only be exposed to trusted users; the local emulator is not a production network isolation boundary.

## Request

Radar sends a JSON `POST` with these headers:

| Header              | Value                                           |
| ------------------- | ----------------------------------------------- |
| `Content-Type`      | `application/json`                              |
| `Webhook-Id`        | Stable event ID, unchanged on retries           |
| `Webhook-Timestamp` | Unix timestamp in seconds for this attempt      |
| `Webhook-Signature` | `v1=` followed by the hex HMAC-SHA256 signature |

Example finding event:

```json
{
  "id": "2e383956-3202-4c4c-89d2-e44af5bea1d7",
  "type": "findings.created",
  "version": 1,
  "createdAt": "2026-09-19T09:00:00.000Z",
  "data": {
    "task": {
      "id": "task-id",
      "title": "Product releases",
      "url": "https://radar.fdemir.dev/tasks/task-id"
    },
    "runId": "run-id",
    "findings": [
      {
        "id": "finding-id",
        "title": "New release",
        "summary": "A new version is available.",
        "reason": "Matches the task brief.",
        "evidence": "Optional source excerpt",
        "url": "https://example.com/release",
        "source": "example.com",
        "date": "2026-09-19"
      }
    ]
  }
}
```

Test events have `type: "webhook.test"` and `data: { "message": "Your Radar webhook is connected." }` with the same envelope and signature format.

## Verify and acknowledge

Compute HMAC-SHA256 over `timestamp + "." + rawBody`, using the signing key **as UTF-8 text**, not hex-decoded bytes. Compare signatures in constant time. Reject timestamps more than five minutes in the past or future. Verify before parsing the body or processing findings.

Node.js verification example:

```js
import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyWebhook(rawBody, headers, secret) {
  const timestamp = headers.get("Webhook-Timestamp") ?? "";
  const signature = headers.get("Webhook-Signature") ?? "";
  if (!/^\d+$/.test(timestamp) || !/^v1=[a-f0-9]{64}$/.test(signature)) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const expected = createHmac("sha256", secret)
    .update(timestamp + ".")
    .update(rawBody)
    .digest();
  return timingSafeEqual(expected, Buffer.from(signature.slice(3), "hex"));
}
```

Use the exact raw bytes, not reserialized JSON. After verification, persist the event to a durable queue or process it transactionally, deduplicating by `Webhook-Id` (also the body's `id`). Return a 2xx response within ten seconds, including for an already processed event. Keep deduplication records for at least seven days; backlogs can delay retries further.

Delivery is **at least once**: an endpoint may accept a message while its response is lost. Radar retries network failures, timeouts, HTTP 408, 429, and 5xx responses, up to five total attempts. Retry delays start at one minute and double, with valid `Retry-After` delays respected up to 24 hours. The scheduler runs once per minute. The event ID and body stay identical; each attempt receives a fresh timestamp and signature. Other non-2xx responses fail immediately, including redirects. Delivery order is not guaranteed.

The latest delivery status is visible in Settings. Failed deliveries remain stored but are not automatically restarted after the attempt limit. A test checks current connectivity; it does not replay old findings. Editing or pausing a task, disabling notifications, replacing the URL, or disconnecting cancels pending finding deliveries. A request already in flight may still reach the old endpoint.

## API and operation

These endpoints require the signed-in user's session. Mutations require the configured frontend Origin, following Radar's existing settings API:

- `GET /api/webhook`: connection and latest delivery status; never returns the signing key.
- `PUT /api/webhook` with `{ "url": "https://..." }`: replaces the connection and returns its new signing key once.
- `PATCH /api/webhook` with `{ "enabled": true }`: changes delivery preference after successful verification.
- `POST /api/webhook/test`: persists and attempts a test; limited to once per minute per account.
- `DELETE /api/webhook`: disconnects and deletes its deliveries.

Migration `0009_webhooks.sql` adds the connection, durable outbox, and cancellation triggers. New finding deliveries are created in the same D1 transaction as research completion. Both the research queue handler and scheduler drain the outbox. Claims use unique leases so an abandoned worker cannot overwrite a newer attempt. No additional provider credentials are required.

Signing keys and endpoint URLs are sensitive database values. Do not include them in logs or diagnostics. Stored errors contain only generic failure messages or HTTP status codes; endpoint response bodies are discarded.

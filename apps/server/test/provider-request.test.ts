import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ResearchDeferred, type ResearchAttempt } from "@radar/core/research";
import { requestProvider } from "../../../packages/agent/src/provider-request";
import { createRetrieval } from "../../../packages/agent/src/retrieval";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function request() {
  const attempts: ResearchAttempt[] = [];
  const send = vi.fn<(signal: AbortSignal) => Promise<Response>>();
  const reserve = vi.fn(async () => {});
  const controller = new AbortController();
  const options = {
    service: "fetch" as const,
    operation: "tool:read",
    target: "https://events.example.com/",
    signal: controller.signal,
    deadline: Date.now() + 300_000,
    timeoutMs: 45_000,
    attempts,
    reserve,
    send,
    parse: (body: unknown) => body,
  };

  return { options, attempts, send, reserve, controller };
}

it.each([500, 502, 503, 504])(
  "retries HTTP %s with 1s and 3s waits and reserves every request",
  async (status) => {
    const { options, send, reserve, attempts } = request();

    send.mockImplementation(async () => new Response("Unavailable", { status }));

    const done = expect(requestProvider(options)).rejects.toMatchObject({ kind: "http", status });

    await vi.advanceTimersByTimeAsync(999);
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(3000);
    await done;
    expect(send).toHaveBeenCalledTimes(3);
    expect(reserve).toHaveBeenCalledTimes(3);
    expect(attempts.map((item) => item.attempt)).toEqual([1, 2, 3]);
    expect(attempts[2]?.retryAt).toBeNull();
  },
);

it("recovers a connection failure and records success without storing error bodies", async () => {
  const { options, send, attempts } = request();

  send
    .mockRejectedValueOnce(new TypeError("Connection reset: secret-token"))
    .mockResolvedValueOnce(Response.json({ result: "ok" }));

  const done = expect(requestProvider(options)).resolves.toEqual({ result: "ok" });

  await vi.advanceTimersByTimeAsync(1000);
  await done;
  expect(attempts.map((item) => item.error)).toEqual(["network", null]);
  expect(JSON.stringify(attempts)).not.toContain("secret-token");
});

it.each([400, 401, 403, 404, 501])("does not retry permanent HTTP %s failures", async (status) => {
  const { options, send, attempts } = request();

  send.mockResolvedValue(new Response("No", { status }));
  await expect(requestProvider(options)).rejects.toMatchObject({ kind: "http", status });
  expect(send).toHaveBeenCalledTimes(1);
  expect(attempts[0]?.retryAt).toBeNull();
});

it("allows only one extra timeout attempt", async () => {
  const { options, send, attempts } = request();

  send.mockRejectedValue(new DOMException("Timed out", "TimeoutError"));

  const done = expect(requestProvider(options)).rejects.toMatchObject({ kind: "timeout" });

  await vi.advanceTimersByTimeAsync(1000);
  await done;
  expect(send).toHaveBeenCalledTimes(2);
  expect(attempts.map((item) => item.error)).toEqual(["timeout", "timeout"]);
});

it("does not retry when the remaining time cannot fit another attempt", async () => {
  const { options, send, attempts } = request();

  send.mockResolvedValue(new Response("Unavailable", { status: 503 }));
  await expect(
    requestProvider({ ...options, deadline: Date.now() + 45_000 }),
  ).rejects.toMatchObject({ kind: "http" });
  expect(send).toHaveBeenCalledTimes(1);
  expect(attempts[0]?.retryAt).toBeNull();
});

it("does not reserve or send after the total deadline", async () => {
  const { options, send, reserve } = request();

  await expect(requestProvider({ ...options, deadline: Date.now() })).rejects.toMatchObject({
    name: "TimeoutError",
  });
  expect(send).not.toHaveBeenCalled();
  expect(reserve).not.toHaveBeenCalled();
});

it("cancels a retry wait without making a second request", async () => {
  const { options, send, controller } = request();
  const reason = new Error("Cancelled");

  send.mockResolvedValue(new Response("Unavailable", { status: 503 }));

  const done = expect(requestProvider(options)).rejects.toBe(reason);

  await vi.advanceTimersByTimeAsync(0);
  controller.abort(reason);
  await done;
  await vi.advanceTimersByTimeAsync(5000);
  expect(send).toHaveBeenCalledTimes(1);
});

it("checks the task is still active before spending quota on a retry", async () => {
  const { options, send, reserve } = request();
  const stopped = new Error("Task paused");
  const beforeAttempt = vi
    .fn<() => Promise<void>>()
    .mockResolvedValueOnce()
    .mockRejectedValueOnce(stopped);

  send.mockResolvedValue(new Response("Unavailable", { status: 503 }));

  const done = expect(requestProvider({ ...options, beforeAttempt })).rejects.toBe(stopped);

  await vi.advanceTimersByTimeAsync(1000);
  await done;
  expect(send).toHaveBeenCalledTimes(1);
  expect(reserve).toHaveBeenCalledTimes(1);
});

it.each([null, "120", "invalid", "Thu, 17 Sep 2026 14:02:00 GMT"])(
  "defers 429 with Retry-After %s instead of retrying inline",
  async (header) => {
    vi.setSystemTime(new Date("2026-09-17T14:00:00Z"));

    const { options, send, attempts } = request();
    const backoff = vi.fn(async () => {});

    send.mockResolvedValue(
      new Response(null, { status: 429, headers: header ? { "Retry-After": header } : {} }),
    );
    await expect(requestProvider({ ...options, backoff })).rejects.toMatchObject({
      retryAt: Date.now() + (!header || header === "invalid" ? 60_000 : 120_000),
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(backoff).toHaveBeenCalledExactlyOnceWith("fetch", attempts[0]?.retryAt);
    expect(attempts[0]?.error).toBe("rate_limit");
  },
);

it("preserves the transient retry budget across rate-limit deferrals", async () => {
  const { options, send, attempts } = request();

  send
    .mockResolvedValueOnce(new Response(null, { status: 503 }))
    .mockResolvedValueOnce(new Response(null, { status: 502 }))
    .mockResolvedValueOnce(new Response(null, { status: 429 }));

  const deferred = expect(requestProvider(options)).rejects.toBeInstanceOf(ResearchDeferred);

  await vi.advanceTimersByTimeAsync(4000);
  await deferred;
  send.mockResolvedValueOnce(new Response(null, { status: 503 }));
  await expect(requestProvider(options)).rejects.toMatchObject({ kind: "http", status: 503 });
  expect(send).toHaveBeenCalledTimes(4);
  expect(attempts.map((item) => item.attempt)).toEqual([1, 2, 3, 4]);
  expect(attempts[3]?.retryAt).toBeNull();
});

it("does not retry malformed JSON or schema failures", async () => {
  const { options, send, attempts } = request();

  send.mockResolvedValueOnce(new Response("not JSON"));
  await expect(requestProvider(options)).rejects.toMatchObject({ kind: "invalid_response" });
  send.mockResolvedValueOnce(Response.json({ wrong: true }));
  await expect(
    requestProvider({
      ...options,
      parse: () => {
        throw new Error("Schema failed");
      },
    }),
  ).rejects.toMatchObject({ kind: "invalid_response" });
  expect(send).toHaveBeenCalledTimes(2);
  expect(attempts.map((item) => item.error)).toEqual(["invalid_response", "invalid_response"]);
});

it("redacts credentials from diagnostic URLs", async () => {
  const { options, send, attempts } = request();

  send.mockResolvedValue(Response.json({ ok: true }));
  await requestProvider({
    ...options,
    target: "https://user:password@events.example.com/?api_key=hidden&event=42#private",
  });
  expect(attempts[0]?.target).toBe("https://events.example.com/?api_key=REDACTED&event=42");
});

it.each([
  { error: "timeout", status: undefined, attempts: 2, kind: "timeout" },
  { error: "target_http_error", status: 503, attempts: 3, kind: "http" },
  { error: "target_http_error", status: 403, attempts: 1, kind: "http" },
  { error: "bot_blocked", status: undefined, attempts: 1, kind: "source_error" },
  { error: "login_required", status: undefined, attempts: 1, kind: "source_error" },
])(
  "handles TinyFish's HTTP-200 per-page $error / $status response",
  async ({ error, status, attempts: expected, kind }) => {
    const url = "https://events.example.com/";
    const attempts: ResearchAttempt[] = [];
    const fetcher = vi.fn(async () =>
      Response.json({ results: [], errors: [{ url, error, status }] }),
    );

    vi.stubGlobal("fetch", fetcher);

    const retrieval = createRetrieval("private-key", "Events", new AbortController().signal, {
      attempts,
    });
    const done = expect(retrieval.read(url, "Events")).rejects.toMatchObject({ kind });

    await vi.advanceTimersByTimeAsync(4000);
    await done;
    expect(fetcher).toHaveBeenCalledTimes(expected);
    expect(attempts[0]).toMatchObject({ status: 200, sourceStatus: status ?? null, code: error });
    expect(JSON.stringify(attempts)).not.toContain("private-key");
  },
);

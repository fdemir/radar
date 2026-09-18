import { readdir, readFile } from "node:fs/promises";
import { URL } from "node:url";
import { createHmac } from "node:crypto";
import { Miniflare } from "miniflare";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { createAuth } from "@radar/auth";
import { createDb } from "@radar/db";
import { createWebhookConnections } from "@radar/db/webhook";
import { createResearch } from "@radar/db/research";
import { createWorkspace } from "@radar/db/workspace";
import { deliverWebhooks } from "@radar/notifications";
import { webhookStatusSchema, webhookUrlSchema } from "@radar/core/webhook";
import type { TaskInput } from "@radar/core";
import { createApp } from "../src/app";

const config = {
  BETTER_AUTH_URL: "http://localhost:3000",
  BETTER_AUTH_SECRET: "webhook-test-secret-at-least-32-characters",
  CORS_ORIGIN: "http://localhost:5174",
};
const taskInput: TaskInput = {
  title: "Releases",
  brief: "Find new stable releases of Hono.",
  category: "Technology",
  status: "active",
  frequency: "Daily",
  time: "09:00",
  language: "English",
  email: false,
  messages: [],
  revision: 0,
};
let runtime: Miniflare;
let d1: Awaited<ReturnType<Miniflare["getD1Database"]>>;
let db: ReturnType<typeof createDb>;
let app: ReturnType<typeof createApp>;
let alice: string;
let bob: string;
let owner: string;
let endpointStatus: number;
let retryAfter: string | null;
let networkError: boolean;
let calls: { url: string; headers: Headers; body: string; redirect: RequestInit["redirect"] }[];

beforeAll(async () => {
  runtime = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('Test'); } }",
    d1Databases: ["DB"],
    compatibilityDate: "2026-07-01",
  });
  d1 = await runtime.getD1Database("DB");
  db = createDb({ DB: d1 });

  const folder = new URL("../../../packages/db/src/migrations/", import.meta.url);

  for (const file of (await readdir(folder)).filter((file) => file.endsWith(".sql")).sort()) {
    const sql = await readFile(new URL(file, folder), "utf8");

    await d1.batch(
      sql
        .split("--> statement-breakpoint")
        .filter((part) => part.trim())
        .map((part) => d1.prepare(part)),
    );
  }
}, 30_000);
afterAll(async () => {
  await runtime?.dispose();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function request(
  path: string,
  method = "GET",
  body?: unknown,
  cookie = alice,
  origin = config.CORS_ORIGIN,
) {
  return app.request(config.BETTER_AUTH_URL + path, {
    method,
    headers: { Origin: origin, Cookie: cookie, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function register(username: string) {
  const response = await request(
    "/api/auth/sign-up/email",
    "POST",
    { username, name: username, email: `${username}@example.com`, password: "test-password-123" },
    "",
  );

  expect(response.status).toBe(200);

  return response.headers
    .getSetCookie()
    .map((item) => item.split(";")[0])
    .join("; ");
}

beforeEach(async () => {
  await d1.batch(["user", "rate_limit"].map((table) => d1.prepare(`DELETE FROM ${table}`)));
  app = createApp(createAuth(config, db), config.CORS_ORIGIN, db);
  alice = await register("alice");
  bob = await register("bob");
  owner =
    (await d1.prepare("SELECT id FROM user WHERE username = 'alice'").first<string>("id")) ?? "";
  endpointStatus = 200;
  retryAfter = null;
  networkError = false;
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({
        url,
        headers: new Headers(init.headers),
        body: String(init.body),
        redirect: init.redirect,
      });

      if (networkError) throw new Error("A private provider error with credentials");

      return new Response(null, {
        status: endpointStatus,
        headers: retryAfter ? { "Retry-After": retryAfter } : {},
      });
    }),
  );
});

async function save(url = "https://hooks.example.com/radar") {
  const response = await request("/api/webhook", "PUT", { url });

  expect(response.status).toBe(200);

  return response.json() as Promise<{ secret: string }>;
}

async function connect() {
  const saved = await save();

  expect((await request("/api/webhook/test", "POST")).status).toBe(200);
  calls = [];

  return saved;
}

async function status(cookie = alice) {
  return webhookStatusSchema.parse(
    await (await request("/api/webhook", "GET", undefined, cookie)).json(),
  ).connection;
}

async function complete() {
  const task = await createWorkspace(db).create(owner, taskInput);
  const research = createResearch(db);
  const runId = await research.start(owner, task.id);
  const claimed = await research.claim(runId);
  const result = {
    findings: [
      {
        title: "A new stable release",
        summary: "Now available",
        reason: "Official source",
        url: "https://hono.dev",
        eventKey: "release",
        version: "1",
      },
    ],
    sources: ["https://hono.dev"],
    summary: "One release",
  };

  expect(claimed).toBeTruthy();
  await research.complete(runId, claimed!.lease, result);

  return { task, runId, research, lease: claimed!.lease, result };
}

const deliver = () => deliverWebhooks(db, config.CORS_ORIGIN);
const due = () =>
  d1
    .prepare("UPDATE webhook_delivery SET next_attempt = 0 WHERE status IN ('pending', 'sending')")
    .run();

it("requires authentication, same-origin writes and keeps accounts and signing keys isolated", async () => {
  expect((await request("/api/webhook", "GET", undefined, "")).status).toBe(401);
  expect(
    (
      await request(
        "/api/webhook",
        "PUT",
        { url: "https://hooks.example.com" },
        alice,
        "https://evil.example.com",
      )
    ).status,
  ).toBe(403);

  const { secret } = await save();

  expect(secret).toMatch(/^[a-f0-9]{64}$/);
  expect(await status(bob)).toBeNull();
  expect(await (await request("/api/webhook")).text()).not.toContain(secret);
  await request("/api/webhook", "DELETE", undefined, bob);
  expect(await status()).not.toBeNull();
  expect((await request("/api/webhook", "PATCH", { enabled: true })).status).toBe(409);
});

it.each([
  "http://hooks.example.com",
  "https://localhost",
  "https://foo.local",
  "https://127.1",
  "https://0x7f000001",
  "https://2130706433",
  "https://10.0.0.1",
  "https://[::1]",
  "https://[::ffff:127.0.0.1]",
  "https://user:pass@hooks.example.com",
  "https://hooks.example.com:8443",
  "https://hooks.example.com/#secret",
  "https://hooks.example.com.",
])("rejects unsafe endpoint %s", async (url) => {
  expect(webhookUrlSchema.safeParse(url).success).toBe(false);
  expect((await request("/api/webhook", "PUT", { url })).status).toBe(400);
  expect(calls).toHaveLength(0);
});

it("enables only after a signed test and rate-limits test sends", async () => {
  const { secret } = await save();

  expect((await status())?.enabled).toBe(false);
  await request("/api/webhook/test", "POST");
  expect(await status()).toMatchObject({
    enabled: true,
    verified: true,
    lastDelivery: { status: "sent", attempts: 1 },
  });

  const sent = calls[0]!;
  const timestamp = sent.headers.get("Webhook-Timestamp")!;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${sent.body}`).digest("hex");

  expect(sent.headers.get("Webhook-Signature")).toBe(`v1=${expected}`);
  expect(JSON.parse(sent.body)).toMatchObject({
    id: sent.headers.get("Webhook-Id"),
    type: "webhook.test",
    version: 1,
  });
  expect(sent.redirect).toBe("manual");
  expect((await request("/api/webhook/test", "POST")).status).toBe(429);
  expect(calls).toHaveLength(1);
});

it("delivers new findings once despite completion replay and concurrent consumers", async () => {
  await connect();

  const run = await complete();

  await run.research.complete(run.runId, run.lease, run.result);
  await Promise.all([deliver(), deliver()]);
  expect(calls).toHaveLength(1);
  expect(JSON.parse(calls[0]!.body)).toMatchObject({
    type: "findings.created",
    data: {
      runId: run.runId,
      task: { id: run.task.id, title: "Releases" },
      findings: [{ title: "A new stable release", url: "https://hono.dev" }],
    },
  });
  await deliver();
  expect(calls).toHaveLength(1);
});

it("does not queue duplicate findings or findings for a disabled connection", async () => {
  await connect();

  const run = await complete();

  await deliver();
  await d1.prepare("UPDATE task SET next_run_at = 0 WHERE id = ?").bind(run.task.id).run();

  const next = await run.research.start(owner, run.task.id, Date.now() + 60_000);
  const claimed = await run.research.claim(next);

  await run.research.complete(next, claimed!.lease, run.result);
  await deliver();
  expect(calls).toHaveLength(1);
  await request("/api/webhook", "PATCH", { enabled: false });
  await complete();
  await deliver();
  expect(calls).toHaveLength(1);
});

it("retries temporary errors with a stable payload and ID and honors Retry-After", async () => {
  await connect();
  await complete();
  endpointStatus = 429;
  retryAfter = "120";
  await deliver();
  expect((await status())?.lastDelivery).toMatchObject({ status: "pending", attempts: 1 });

  const next = await d1
    .prepare("SELECT next_attempt FROM webhook_delivery WHERE kind = 'findings'")
    .first<number>("next_attempt");

  expect(next).toBeGreaterThan(Date.now() + 110_000);
  await deliver();
  expect(calls).toHaveLength(1);
  await due();
  endpointStatus = 200;
  await deliver();
  expect(calls).toHaveLength(2);
  expect(calls[1]!.body).toBe(calls[0]!.body);
  expect(calls[1]!.headers.get("Webhook-Id")).toBe(calls[0]!.headers.get("Webhook-Id"));
  expect((await status())?.lastDelivery).toMatchObject({ status: "sent", attempts: 2 });
});

it.each([302, 400, 401, 403, 404, 410])(
  "does not retry permanent HTTP %s or follow redirects",
  async (code) => {
    await connect();
    await complete();
    endpointStatus = code;
    await deliver();
    await due();
    await deliver();
    expect(calls).toHaveLength(1);
    expect((await status())?.lastDelivery).toMatchObject({
      status: "failed",
      error: `Endpoint returned HTTP ${code}`,
    });
  },
);

it("stops after five network failures without exposing raw errors", async () => {
  await connect();
  await complete();
  networkError = true;

  for (let attempt = 0; attempt < 6; attempt++) {
    await due();
    await deliver();
  }

  expect(calls).toHaveLength(5);
  expect((await status())?.lastDelivery).toMatchObject({
    status: "failed",
    attempts: 5,
    error: "Endpoint did not respond",
  });
});

it.each(["pause", "edit", "disable", "disconnect", "replace"])(
  "cancels pending deliveries on %s",
  async (action) => {
    await connect();

    const { task } = await complete();

    if (action === "pause")
      await createWorkspace(db).update(owner, task.id, { ...taskInput, status: "paused" });

    if (action === "edit")
      await createWorkspace(db).update(owner, task.id, { ...taskInput, title: "Changed task" });

    if (action === "disable") await request("/api/webhook", "PATCH", { enabled: false });

    if (action === "disconnect") await request("/api/webhook", "DELETE");

    if (action === "replace") await save("https://other.example.com/hook");

    await deliver();
    expect(calls).toHaveLength(0);

    if (["pause", "edit", "disable"].includes(action))
      expect(
        await d1
          .prepare("SELECT status FROM webhook_delivery WHERE kind = 'findings'")
          .first("status"),
      ).toBe("cancelled");
    else expect(await d1.prepare("SELECT count(*) AS n FROM webhook_delivery").first("n")).toBe(0);
  },
);

it("recovers an abandoned claim and rejects its late completion", async () => {
  await connect();
  await complete();

  let resolveFirst: (response: Response) => void = () => {};

  const reached = Promise.withResolvers<void>();

  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      reached.resolve();

      return new Promise<Response>((resolve) => {
        resolveFirst = resolve;
      });
    }),
  );

  const oldAttempt = deliver();

  await reached.promise;
  await due();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 400 })),
  );
  await deliver();
  resolveFirst(new Response(null, { status: 200 }));
  await oldAttempt;
  expect((await status())?.lastDelivery).toMatchObject({
    status: "failed",
    attempts: 2,
    error: "Endpoint returned HTTP 400",
  });
});

it("does not resume a paused connection after a successful test", async () => {
  await connect();
  await request("/api/webhook", "PATCH", { enabled: false });
  await createWebhookConnections(db).test(owner);
  await deliver();
  expect((await status())?.enabled).toBe(false);
});

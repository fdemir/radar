import { createResearch } from "@radar/db/research";
import { URL } from "node:url";
import { readdir, readFile } from "node:fs/promises";
import { createAuth } from "@radar/auth";
import { createDb } from "@radar/db";
import { workspaceSchema, type TaskInput } from "@radar/core";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import z from "zod";
import { createApp } from "../src/app";

const config = {
  BETTER_AUTH_URL: "http://localhost:3000",
  BETTER_AUTH_SECRET: "workspace-test-secret-32-characters-long",
  CORS_ORIGIN: "http://localhost:5174",
};
let runtime: Miniflare;
let d1: Awaited<ReturnType<Miniflare["getD1Database"]>>;
let app: ReturnType<typeof createApp>;
let alice: string;
let bob: string;
const input: TaskInput = {
  title: "Local AI tools",
  brief: "Find new open-source tools that run locally.",
  category: "Technology",
  status: "draft",
  frequency: "Daily",
  time: "09:00",
  language: "English",
  email: true,
  messages: [],
  revision: 0,
};
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
async function create(value = input, cookie = alice) {
  const response = await request("/api/tasks", "POST", value, cookie);
  expect(response.status, await response.clone().text()).toBe(201);
  return z.object({ id: z.string() }).parse(await response.json()).id;
}
async function snapshot(cookie = alice) {
  const response = await request("/api/workspace", "GET", undefined, cookie);
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  return workspaceSchema.parse(await response.json());
}
beforeAll(async () => {
  runtime = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('Test'); } }",
    d1Databases: ["DB"],
    compatibilityDate: "2026-07-01",
  });
  d1 = await runtime.getD1Database("DB");
  const folder = new URL("../../../packages/db/src/migrations/", import.meta.url);
  for (const file of (await readdir(folder)).filter((file) => file.endsWith(".sql")).sort()) {
    const sql = await readFile(new URL(file, folder), "utf8");
    await d1.batch(
      sql
        .split("--> statement-breakpoint")
        .filter((sql) => sql.trim())
        .map((sql) => d1.prepare(sql)),
    );
  }
}, 30_000);
afterAll(async () => {
  await runtime?.dispose();
});
beforeEach(async () => {
  await d1.batch(["user", "rate_limit"].map((table) => d1.prepare(`DELETE FROM ${table}`)));
  const db = createDb({ DB: d1 });
  app = createApp(createAuth(config, db), config.CORS_ORIGIN, db);
  alice = await register("alice");
  bob = await register("bob");
});

it("persists task edits and conversations across app instances, scoped to the session", async () => {
  const id = await create({ ...input, messages: [{ role: "user", text: "Only open source" }] });
  expect((await snapshot(bob)).tasks).toEqual([]);
  expect((await request(`/api/tasks/${id}`, "PUT", input, bob)).status).toBe(404);
  expect((await request(`/api/tasks/${id}`, "DELETE", undefined, bob)).status).toBe(404);
  const task = (await snapshot()).tasks[0]!;
  expect(task.messages[0]?.text).toBe("Only open source");
  expect((await request(`/api/tasks/${id}`, "PUT", { ...task, title: "Updated" })).status).toBe(
    200,
  );
  expect((await request(`/api/tasks/${id}`, "PUT", task)).status).toBe(409);
  const db = createDb({ DB: d1 });
  app = createApp(createAuth(config, db), config.CORS_ORIGIN, db);
  expect((await snapshot()).tasks[0]?.title).toBe("Updated");
  expect((await request(`/api/tasks/${id}`, "DELETE")).status).toBe(204);
  expect((await snapshot()).tasks).toEqual([]);
});

it("enforces the active task limit during concurrent creates and resumes", async () => {
  const responses = await Promise.all(
    Array.from({ length: 8 }, () => request("/api/tasks", "POST", { ...input, status: "active" })),
  );
  expect(responses.filter((response) => response.status === 201)).toHaveLength(5);
  expect(responses.filter((response) => response.status === 409)).toHaveLength(3);
  const draft = await create();
  expect((await request(`/api/tasks/${draft}`, "PUT", { ...input, status: "active" })).status).toBe(
    409,
  );
  const active = (await snapshot()).tasks.find((task) => task.status === "active")!;
  expect(
    (await request(`/api/tasks/${active.id}`, "PUT", { ...active, status: "paused" })).status,
  ).toBe(200);
  expect((await request(`/api/tasks/${draft}`, "PUT", { ...input, status: "active" })).status).toBe(
    200,
  );
  await create({ ...input, status: "active" }, bob);
});

it("validates requests and rejects unauthenticated and cross-origin writes", async () => {
  expect((await request("/api/workspace", "GET", undefined, "")).status).toBe(401);
  expect((await request("/api/tasks", "POST", input, "")).status).toBe(401);
  expect((await request("/api/tasks", "POST", input, alice, "https://other.example")).status).toBe(
    403,
  );
  for (const patch of [
    { frequency: "Every minute" },
    { time: "29:00" },
    { language: "French" },
    { status: "active", brief: "" },
  ]) {
    expect((await request("/api/tasks", "POST", { ...input, ...patch })).status).toBe(400);
  }
  expect((await snapshot()).tasks).toEqual([]);
});

it("saves preferences without letting the client verify or replace the account email", async () => {
  expect(
    (
      await request("/api/preferences", "PATCH", {
        name: "Alice Radar",
        timezone: "Europe/Istanbul",
        language: "Türkçe",
        emailEnabled: false,
      })
    ).status,
  ).toBe(204);
  expect((await snapshot()).preferences).toMatchObject({
    name: "Alice Radar",
    timezone: "Europe/Istanbul",
    language: "Türkçe",
    emailEnabled: false,
    verified: false,
  });
  expect((await snapshot(bob)).preferences.name).toBe("bob");
  for (const patch of [
    { verified: true },
    { email: "changed@example.com" },
    { timezone: "Mars/Olympus" },
  ]) {
    expect((await request("/api/preferences", "PATCH", patch)).status).toBe(400);
  }
});

async function researcher() {
  const response = await request("/api/me");
  const { user } = z.object({ user: z.object({ id: z.string() }) }).parse(await response.json());
  return { userId: user.id, research: createResearch(createDb({ DB: d1 })) };
}
const result = {
  summary: "A new tool release.",
  sources: ["https://example.com/release"],
  findings: [
    {
      title: "Tool v2",
      summary: "A new release.",
      reason: "Runs locally.",
      url: "https://example.com/release",
      eventKey: "tool-release",
      version: "2.0",
    },
  ],
};
it("claims a run once and saves findings and one email together, deduplicating later runs", async () => {
  const taskId = await create({ ...input, status: "active" });
  const { research, userId } = await researcher();
  await d1.prepare("UPDATE user SET email_verified = 1 WHERE id = ?").bind(userId).run();
  const now = Date.now();
  const runId = await research.start(userId, taskId, now);
  const claims = await Promise.all([research.claim(runId), research.claim(runId)]);
  expect(claims.filter(Boolean)).toHaveLength(1);
  await research.complete(runId, claims.find(Boolean)!.lease, result, now + 1000);
  expect(await d1.prepare("SELECT count(*) AS n FROM finding").first("n")).toBe(1);
  expect(await d1.prepare("SELECT count(*) AS n FROM delivery").first("n")).toBe(1);
  const second = await research.start(userId, taskId, now + 11_000);
  const claim = await research.claim(second);
  await research.complete(second, claim!.lease, result, now + 12_000);
  expect(await d1.prepare("SELECT count(*) AS n FROM finding").first("n")).toBe(1);
  expect(await d1.prepare("SELECT count(*) AS n FROM delivery").first("n")).toBe(1);
  expect(
    await d1.prepare("SELECT outcome FROM run WHERE id = ?").bind(second).first("outcome"),
  ).toBe("unchanged");
  const updated = await research.start(userId, taskId, now + 22_000);
  const updatedClaim = await research.claim(updated);
  await research.complete(
    updated,
    updatedClaim!.lease,
    { ...result, findings: [{ ...result.findings[0]!, version: "3.0" }] },
    now + 23_000,
  );
  expect(await d1.prepare("SELECT count(*) AS n FROM finding").first("n")).toBe(2);
});
it("cancels old work after edits and pauses, and pauses a task after three failures", async () => {
  const taskId = await create({ ...input, status: "active" });
  const { research, userId } = await researcher();
  const now = Date.now();
  const id = await research.start(userId, taskId, now);
  const claim = await research.claim(id);
  const task = (await snapshot()).tasks[0]!;
  await request(`/api/tasks/${taskId}`, "PUT", { ...task, title: "Edited" });
  await research.complete(id, claim!.lease, result);
  expect(await d1.prepare("SELECT count(*) AS n FROM finding").first("n")).toBe(0);
  expect(await d1.prepare("SELECT status FROM run WHERE id = ?").bind(id).first("status")).toBe(
    "cancelled",
  );
  for (let i = 1; i <= 3; i++) {
    const next = await research.start(userId, taskId, now + i * 11_000);
    const running = await research.claim(next);
    await research.fail(next, running!.lease, "Source unavailable.");
    await research.fail(next, running!.lease, "Duplicate failure.");
  }
  expect((await snapshot()).tasks[0]).toMatchObject({ status: "paused", failures: 3 });
});
it("keeps cooldown and daily usage on the server even when tasks are deleted", async () => {
  const taskId = await create({ ...input, status: "active" });
  const { research, userId } = await researcher();
  const now = Date.now();
  const id = await research.start(userId, taskId, now);
  await expect(research.start(userId, taskId, now + 1)).rejects.toThrow("Wait 10 seconds");
  const claim = await research.claim(id);
  await research.complete(id, claim!.lease, { summary: "No matches.", sources: [], findings: [] });
  await d1.prepare("UPDATE usage SET checks = 30 WHERE user_id = ?").bind(userId).run();
  await request(`/api/tasks/${taskId}`, "DELETE");
  const replacement = await create({ ...input, status: "active" });
  await expect(research.start(userId, replacement, now + 11_000)).rejects.toThrow("Daily limit");
  expect(await research.checks(userId, now)).toBe(30);
});
it("rolls back findings if the delivery outbox cannot be saved", async () => {
  const taskId = await create({ ...input, status: "active" });
  const { research, userId } = await researcher();
  await d1.prepare("UPDATE user SET email_verified = 1 WHERE id = ?").bind(userId).run();
  const id = await research.start(userId, taskId);
  const claim = await research.claim(id);
  await d1
    .prepare(
      "CREATE TRIGGER test_delivery_failure BEFORE INSERT ON delivery BEGIN SELECT RAISE(ABORT, 'test_failure'); END;",
    )
    .run();
  try {
    await expect(research.complete(id, claim!.lease, result)).rejects.toThrow();
  } finally {
    await d1.prepare("DROP TRIGGER test_delivery_failure").run();
  }
  expect(await d1.prepare("SELECT count(*) AS n FROM finding").first("n")).toBe(0);
  expect(await d1.prepare("SELECT status FROM run WHERE id = ?").bind(id).first("status")).toBe(
    "running",
  );
});
it("never queues email for an unverified account and cancels pending delivery when paused", async () => {
  const taskId = await create({ ...input, status: "active" });
  const { research, userId } = await researcher();
  const now = Date.now();
  const id = await research.start(userId, taskId, now);
  await research.complete(id, (await research.claim(id))!.lease, result);
  expect(await d1.prepare("SELECT count(*) AS n FROM delivery").first("n")).toBe(0);
  await d1.prepare("UPDATE user SET email_verified = 1 WHERE id = ?").bind(userId).run();
  const next = await research.start(userId, taskId, now + 11_000);
  await research.complete(next, (await research.claim(next))!.lease, {
    ...result,
    findings: [{ ...result.findings[0]!, version: "3.0" }],
  });
  const task = (await snapshot()).tasks[0]!;
  await request(`/api/tasks/${taskId}`, "PUT", { ...task, status: "paused" });
  expect(await d1.prepare("SELECT status FROM delivery").first("status")).toBe("cancelled");
});

it("reschedules active tasks when the timezone changes and cancels mail on the first preference save", async () => {
  const taskId = await create({ ...input, status: "active" });
  const { research, userId } = await researcher();
  await d1.prepare("UPDATE user SET email_verified = 1 WHERE id = ?").bind(userId).run();
  const id = await research.start(userId, taskId);
  await research.complete(id, (await research.claim(id))!.lease, result);
  const before = (await snapshot()).tasks[0]!.nextRunAt;
  expect(
    (
      await request("/api/preferences", "PATCH", {
        timezone: "Europe/Istanbul",
        emailEnabled: false,
      })
    ).status,
  ).toBe(204);
  const after = (await snapshot()).tasks[0]!.nextRunAt;
  expect(after).not.toBe(before);
  expect(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Istanbul",
      hour: "2-digit",
      minute: "2-digit",
    }).format(after!),
  ).toBe("09:00");
  expect(await d1.prepare("SELECT status FROM delivery").first("status")).toBe("cancelled");
  expect((await request("/api/preferences", "PATCH", { emailEnabled: true })).status).toBe(204);
  expect(await d1.prepare("SELECT status FROM delivery").first("status")).toBe("cancelled");
});

it("keeps findings and notification updates private to their owner", async () => {
  const taskId = await create({ ...input, status: "active" });
  const { research, userId } = await researcher();
  await d1.prepare("UPDATE user SET email_verified = 1 WHERE id = ?").bind(userId).run();
  const id = await research.start(userId, taskId);
  await research.complete(id, (await research.claim(id))!.lease, result);
  await d1.prepare("UPDATE delivery SET status = 'sent', sent_at = ?").bind(Date.now()).run();
  const own = await snapshot();
  const foreign = await snapshot(bob);
  expect(own.findings).toHaveLength(1);
  expect(own.runs).toHaveLength(1);
  expect(own.notices).toHaveLength(1);
  expect(foreign.findings).toEqual([]);
  expect(foreign.runs).toEqual([]);
  expect(foreign.notices).toEqual([]);
  const finding = own.findings[0]!;
  expect((await request(`/api/findings/${finding.id}`, "PATCH", { saved: true }, bob)).status).toBe(
    404,
  );
  expect(
    (await request(`/api/findings/${finding.id}`, "PATCH", { read: true, saved: true })).status,
  ).toBe(204);
  expect((await snapshot()).findings[0]).toMatchObject({ read: true, saved: true });
  await request("/api/notices/read", "POST", {}, bob);
  expect((await snapshot()).notices[0]!.read).toBe(false);
  await request("/api/notices/read", "POST", { id: own.notices[0]!.id });
  expect((await snapshot()).notices[0]!.read).toBe(true);
});

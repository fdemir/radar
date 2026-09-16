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
  title: "Local AI tools", brief: "Find new open-source tools that run locally.",
  category: "Technology", status: "draft", frequency: "Daily", time: "09:00",
  language: "English", email: true, messages: [], revision: 0,
};
function request(path: string, method = "GET", body?: unknown, cookie = alice, origin = config.CORS_ORIGIN) {
  return app.request(config.BETTER_AUTH_URL + path, {
    method, headers: { Origin: origin, Cookie: cookie, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function register(username: string) {
  const response = await request("/api/auth/sign-up/email", "POST", { username, name: username, email: `${username}@example.com`, password: "test-password-123" }, "");
  expect(response.status).toBe(200);
  return response.headers.getSetCookie().map((item) => item.split(";")[0]).join("; ");
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
  runtime = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('Test'); } }", d1Databases: ["DB"], compatibilityDate: "2026-07-01" });
  d1 = await runtime.getD1Database("DB");
  const folder = new URL("../../../packages/db/src/migrations/", import.meta.url);
  for (const file of (await readdir(folder)).filter((file) => file.endsWith(".sql")).sort()) {
    const sql = await readFile(new URL(file, folder), "utf8");
    await d1.batch(sql.split("--> statement-breakpoint").filter((sql) => sql.trim()).map((sql) => d1.prepare(sql)));
  }
}, 30_000);
afterAll(async () => { await runtime?.dispose(); });
beforeEach(async () => {
  await d1.batch(["user", "rate_limit"].map((table) => d1.prepare(`DELETE FROM ${table}`)));
  const db = createDb({ DB: d1 });
  app = createApp(createAuth(config, db), config.CORS_ORIGIN, db);
  alice = await register("alice"); bob = await register("bob");
});

it("persists task edits and conversations across app instances, scoped to the session", async () => {
  const id = await create({ ...input, messages: [{ role: "user", text: "Only open source" }] });
  expect((await snapshot(bob)).tasks).toEqual([]);
  expect((await request(`/api/tasks/${id}`, "PUT", input, bob)).status).toBe(404);
  expect((await request(`/api/tasks/${id}`, "DELETE", undefined, bob)).status).toBe(404);
  const task = (await snapshot()).tasks[0]!;
  expect(task.messages[0]?.text).toBe("Only open source");
  expect((await request(`/api/tasks/${id}`, "PUT", { ...task, title: "Updated" })).status).toBe(200);
  expect((await request(`/api/tasks/${id}`, "PUT", task)).status).toBe(409);
  const db = createDb({ DB: d1 }); app = createApp(createAuth(config, db), config.CORS_ORIGIN, db);
  expect((await snapshot()).tasks[0]?.title).toBe("Updated");
  expect((await request(`/api/tasks/${id}`, "DELETE")).status).toBe(204);
  expect((await snapshot()).tasks).toEqual([]);
});

it("enforces the active task limit during concurrent creates and resumes", async () => {
  const responses = await Promise.all(Array.from({ length: 8 }, () => request("/api/tasks", "POST", { ...input, status: "active" })));
  expect(responses.filter((response) => response.status === 201)).toHaveLength(5);
  expect(responses.filter((response) => response.status === 409)).toHaveLength(3);
  const draft = await create();
  expect((await request(`/api/tasks/${draft}`, "PUT", { ...input, status: "active" })).status).toBe(409);
  const active = (await snapshot()).tasks.find((task) => task.status === "active")!;
  expect((await request(`/api/tasks/${active.id}`, "PUT", { ...active, status: "paused" })).status).toBe(200);
  expect((await request(`/api/tasks/${draft}`, "PUT", { ...input, status: "active" })).status).toBe(200);
  await create({ ...input, status: "active" }, bob);
});

it("validates requests and rejects unauthenticated and cross-origin writes", async () => {
  expect((await request("/api/workspace", "GET", undefined, "")).status).toBe(401);
  expect((await request("/api/tasks", "POST", input, "")).status).toBe(401);
  expect((await request("/api/tasks", "POST", input, alice, "https://other.example")).status).toBe(403);
  for (const patch of [{ frequency: "Every minute" }, { time: "29:00" }, { language: "French" }, { status: "active", brief: "" }]) {
    expect((await request("/api/tasks", "POST", { ...input, ...patch })).status).toBe(400);
  }
  expect((await snapshot()).tasks).toEqual([]);
});

it("saves preferences without letting the client verify or replace the account email", async () => {
  expect((await request("/api/preferences", "PATCH", { name: "Alice Radar", timezone: "Europe/Istanbul", language: "Türkçe", emailEnabled: false })).status).toBe(204);
  expect((await snapshot()).preferences).toMatchObject({ name: "Alice Radar", timezone: "Europe/Istanbul", language: "Türkçe", emailEnabled: false, verified: false });
  expect((await snapshot(bob)).preferences.name).toBe("bob");
  for (const patch of [{ verified: true }, { email: "changed@example.com" }, { timezone: "Mars/Olympus" }]) {
    expect((await request("/api/preferences", "PATCH", patch)).status).toBe(400);
  }
});

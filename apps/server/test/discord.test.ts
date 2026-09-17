import { readdir, readFile } from "node:fs/promises";
import { URL } from "node:url";
import z from "zod";
import { discordStatusSchema } from "@radar/core/discord";
import { Miniflare } from "miniflare";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { createAuth } from "@radar/auth";
import { createDb } from "@radar/db";
import { createDiscordConnections } from "@radar/db/discord";
import { createResearch } from "@radar/db/research";
import { createWorkspace } from "@radar/db/workspace";
import { createDiscord, deliverDiscord } from "@radar/notifications";
import { workspaceSchema, type TaskInput } from "@radar/core";
import { createApp } from "../src/app";

const config = {
  BETTER_AUTH_URL: "http://localhost:3000",
  BETTER_AUTH_SECRET: "discord-test-secret-at-least-32-characters",
  CORS_ORIGIN: "http://localhost:5174",
  DISCORD_CLIENT_ID: "123456789",
  DISCORD_CLIENT_SECRET: "test-client-secret",
  DISCORD_BOT_TOKEN: "test-bot-token",
  DISCORD_REDIRECT_URI: "http://localhost:3000/api/discord/callback",
};
const discord = createDiscord(config);
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
let mode: "success" | "no-mutual" | "closed" | "rate-limit" | "timeout";
let calls: { path: string; body: Record<string, unknown>; auth: string | null }[];
let beforeSend: (() => Promise<void>) | undefined;

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
  app = createApp(createAuth(config, db), config.CORS_ORIGIN, db, {
    emailAvailable: false,
    enqueue: async () => {},
    discord,
  });
  alice = await register("alice");
  bob = await register("bob");
  owner = z
    .object({ user: z.object({ id: z.string() }) })
    .parse(await (await request("/api/me")).json()).user.id;
  mode = "success";
  calls = [];
  beforeSend = undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const url = new URL(input);
      const body =
        init.body instanceof URLSearchParams
          ? Object.fromEntries(init.body)
          : typeof init.body === "string"
            ? JSON.parse(init.body)
            : {};

      expect(url.origin).toBe("https://discord.com");
      calls.push({
        path: url.pathname,
        body,
        auth: new Headers(init.headers).get("Authorization"),
      });

      if (url.pathname.endsWith("/oauth2/token"))
        return Response.json({
          access_token: "temporary-user-token",
          scope: "identify applications.commands",
        });

      if (url.pathname === "/api/v10/users/@me")
        return Response.json({ id: "987654321", username: "discord-alice" });

      if (url.pathname.endsWith("/users/@me/channels")) {
        await beforeSend?.();

        return Response.json({ id: "555555555" });
      }

      if (url.pathname.endsWith("/messages")) {
        if (mode === "no-mutual") return Response.json({ code: 50278 }, { status: 403 });

        if (mode === "closed") return Response.json({ code: 50007 }, { status: 403 });

        if (mode === "rate-limit") return Response.json({ retry_after: 120 }, { status: 429 });

        if (mode === "timeout") throw new Error("Response lost");

        return Response.json({ id: String(900000000 + calls.length) });
      }

      throw new Error("Unexpected request");
    }),
  );
});

async function begin(cookie = alice) {
  const response = await request("/api/discord/connect", "POST", undefined, cookie);

  expect(response.status, await response.clone().text()).toBe(200);

  return new URL(z.object({ url: z.string() }).parse(await response.json()).url);
}

async function callback(url: URL, cookie = alice) {
  return request(
    `/api/discord/callback?state=${url.searchParams.get("state")}&code=test-code`,
    "GET",
    undefined,
    cookie,
  );
}

async function connection() {
  return discordStatusSchema.parse(await (await request("/api/discord")).json()).connection;
}

const sends = () => calls.filter((call) => call.path.endsWith("/messages"));
const deliver = () => deliverDiscord(db, discord, config.CORS_ORIGIN);

async function complete(taskId?: string, now = Date.now()) {
  const workspace = createWorkspace(db);
  const research = createResearch(db);
  const task = taskId ?? (await workspace.create(owner, taskInput)).id;
  const runId = await research.start(owner, task, now);
  const claimed = await research.claim(runId);

  expect(claimed).toBeTruthy();
  await research.complete(
    runId,
    claimed!.lease,
    {
      findings: [
        {
          title: "A new stable release",
          summary: "The new release is available.",
          reason: "Official source",
          url: "https://hono.dev",
          eventKey: "release",
          version: "1",
        },
      ],
      sources: ["https://hono.dev"],
      summary: "One release",
    },
    now,
  );

  return { task, runId, claimed };
}

it("connects via user install OAuth, sends a welcome DM and keeps OAuth tokens out of the database", async () => {
  const url = await begin();

  expect(url.searchParams.get("integration_type")).toBe("1");
  expect(url.searchParams.get("scope")).toBe("identify applications.commands");
  expect(url.searchParams.has("guild_id")).toBe(false);
  expect(url.searchParams.get("redirect_uri")).toBe(config.DISCORD_REDIRECT_URI);

  const stored = await d1.prepare("SELECT * FROM discord_authorization").first();

  expect(JSON.stringify(stored)).not.toContain(url.searchParams.get("state"));
  expect((await callback(url)).headers.get("Location")).toBe(
    `${config.CORS_ORIGIN}/settings?discord=linked`,
  );
  expect(await connection()).toMatchObject({
    username: "discord-alice",
    status: "ready",
    enabled: true,
    error: null,
  });
  expect(sends()).toHaveLength(1);
  expect(sends()[0]!.body.content).toContain("Your Radar account is connected");
  expect(sends()[0]!.body.allowed_mentions).toEqual({ parse: [] });
  expect(sends()[0]!.auth).toBe("Bot test-bot-token");
  expect(await d1.prepare("SELECT count(*) FROM discord_authorization").first("count(*)")).toBe(0);
  expect(
    await d1
      .prepare("SELECT count(*) FROM account WHERE provider_id != 'credential'")
      .first("count(*)"),
  ).toBe(0);
});

it("rejects cross-account, tampered, expired and replayed callbacks without sending messages", async () => {
  const url = await begin();

  expect((await callback(url, bob)).headers.get("Location")).toContain("discord=expired");
  expect(
    (await request("/api/discord/callback?state=wrong&code=test")).headers.get("Location"),
  ).toContain("discord=expired");
  expect(calls).toHaveLength(0);
  await callback(url);
  expect((await callback(url)).headers.get("Location")).toContain("discord=expired");
  expect(sends()).toHaveLength(1);
  await request("/api/discord", "DELETE");

  const expired = await begin();

  await d1.prepare("UPDATE discord_authorization SET expires_at = 0").run();
  expect((await callback(expired)).headers.get("Location")).toContain("discord=expired");
  expect(await connection()).toBeNull();
});

it("requires a session and the Radar origin for mutations, and handles denial without linking", async () => {
  expect((await request("/api/discord/connect", "POST", undefined, "")).status).toBe(401);
  expect(
    (await request("/api/discord/connect", "POST", undefined, alice, "https://other.example"))
      .status,
  ).toBe(403);

  const url = await begin();
  const response = await request(
    `/api/discord/callback?state=${url.searchParams.get("state")}&error=access_denied`,
  );

  expect(response.headers.get("Location")).toContain("discord=cancelled");
  expect(await connection()).toBeNull();
  expect(calls).toHaveLength(0);
});

it("prevents a Discord identity from being linked to two Radar accounts", async () => {
  await callback(await begin());
  expect((await callback(await begin(bob), bob)).headers.get("Location")).toContain(
    "discord=conflict",
  );
  expect(
    discordStatusSchema.parse(await (await request("/api/discord", "GET", undefined, bob)).json())
      .connection,
  ).toBeNull();
  expect(sends()).toHaveLength(1);
});

it.each([
  ["no-mutual", "no_mutual_guild"],
  ["closed", "dm_closed"],
] as const)(
  "records %s as linked but blocked and never enables automatic delivery",
  async (failureMode, reason) => {
    mode = failureMode;
    await callback(await begin());
    expect(await connection()).toMatchObject({ status: "blocked", error: reason });
    expect((await request("/api/discord", "PATCH", { enabled: true })).status).toBe(409);
    await complete();
    await deliver();
    expect(sends()).toHaveLength(1);
    mode = "success";
    expect((await request("/api/discord/test", "POST")).status).toBe(200);
    expect(await connection()).toMatchObject({ status: "ready", error: null });
  },
);

it("persists rate limit timing across requests and retries the welcome without creating another delivery", async () => {
  mode = "rate-limit";
  await callback(await begin());
  expect(await connection()).toMatchObject({ status: "pending" });

  const retryAt = await d1
    .prepare("SELECT next_attempt FROM discord_delivery")
    .first<number>("next_attempt");

  expect(retryAt).toBeGreaterThan(Date.now() + 110_000);
  mode = "success";
  await deliver();
  expect(sends()).toHaveLength(1);
  await d1.prepare("UPDATE discord_delivery SET next_attempt = 0").run();
  await deliver();
  expect(sends()).toHaveLength(1);
  await d1.prepare("UPDATE rate_limit SET last_request = 0 WHERE key = 'discord:delivery'").run();
  await deliver();
  expect(sends()).toHaveLength(2);
  expect(sends()[0]!.body.nonce).toBe(sends()[1]!.body.nonce);
  expect(await connection()).toMatchObject({ status: "ready" });
});

it("does not automatically repeat a message when the response is lost", async () => {
  mode = "timeout";
  await callback(await begin());
  expect(await connection()).toMatchObject({ status: "failed", error: "uncertain" });
  expect(await d1.prepare("SELECT status FROM discord_delivery").first("status")).toBe("uncertain");
  mode = "success";
  await deliver();
  expect(sends()).toHaveLength(1);
});

it("delivers new findings with email disabled, deduplicates work and adds an owner-only notification", async () => {
  await callback(await begin());

  const { runId, task, claimed } = await complete();

  await Promise.all([deliver(), deliver()]);
  await deliver();
  expect(sends()).toHaveLength(2);
  expect(sends()[1]!.body.content).toContain(`/tasks/${task}`);
  expect(sends()[1]!.body.content).toContain("https://hono.dev");
  expect(sends()[1]!.body.content).toBe(
    `**A new stable release**\nThe new release is available.\nhttps://hono.dev\n\n[Take a look in Radar](${config.CORS_ORIGIN}/tasks/${task})`,
  );
  expect(await d1.prepare("SELECT count(*) FROM delivery").first("count(*)")).toBe(0);

  const workspace = workspaceSchema.parse(await (await request("/api/workspace")).json());

  expect(workspace.notices).toHaveLength(1);
  expect(workspace.notices[0]!.channel).toBe("Discord");
  expect(
    workspaceSchema.parse(await (await request("/api/workspace", "GET", undefined, bob)).json())
      .notices,
  ).toHaveLength(0);
  await request("/api/notices/read", "POST", { id: workspace.notices[0]!.id }, bob);
  expect(
    await d1
      .prepare("SELECT read FROM discord_delivery WHERE run_id = ?")
      .bind(runId)
      .first("read"),
  ).toBe(0);
  await request("/api/notices/read", "POST", { id: workspace.notices[0]!.id });
  expect(
    await d1
      .prepare("SELECT read FROM discord_delivery WHERE run_id = ?")
      .bind(runId)
      .first("read"),
  ).toBe(1);
  await createResearch(db).complete(runId, claimed!.lease, {
    findings: [],
    sources: [],
    summary: "Retry",
  });
  await complete(task, Date.now() + 20_000);
  await deliver();
  expect(sends()).toHaveLength(2);
});

it.each(["pause", "disable", "disconnect"])(
  "cancels pending findings on %s and keeps them cancelled after resuming",
  async (action) => {
    await callback(await begin());

    const { task, runId } = await complete();

    if (action === "pause")
      await d1.prepare("UPDATE task SET status = 'paused' WHERE id = ?").bind(task).run();

    if (action === "disable") await request("/api/discord", "PATCH", { enabled: false });

    if (action === "disconnect") await request("/api/discord", "DELETE");

    await deliver();
    expect(sends()).toHaveLength(1);

    if (action !== "disconnect") {
      expect(
        await d1
          .prepare("SELECT status FROM discord_delivery WHERE run_id = ?")
          .bind(runId)
          .first("status"),
      ).toBe("cancelled");
      await d1.prepare("UPDATE task SET status = 'active' WHERE id = ?").bind(task).run();
      await request("/api/discord", "PATCH", { enabled: true });
      await deliver();
      expect(sends()).toHaveLength(1);
    }
  },
);

it("rechecks a connection deleted while the DM channel is being opened", async () => {
  beforeSend = async () => {
    await createDiscordConnections(db).disconnect(owner);
  };

  await callback(await begin());
  expect(await connection()).toBeNull();
  expect(sends()).toHaveLength(0);
});

it("disconnect invalidates an OAuth attempt before its callback", async () => {
  const url = await begin();

  await request("/api/discord", "DELETE");
  expect((await callback(url)).headers.get("Location")).toContain("discord=expired");
  expect(calls).toHaveLength(0);
});

it("reports a rate-limited test as pending instead of claiming it was sent", async () => {
  await callback(await begin());
  mode = "rate-limit";

  const response = await request("/api/discord/test", "POST");

  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ deliveryStatus: "pending" });
  expect((await request("/api/discord/test", "POST")).status).toBe(429);
});

it("does not resurrect an authorization invalidated while the identity lookup was in progress", async () => {
  const store = createDiscordConnections(db);
  const url = await begin();
  const state = url.searchParams.get("state")!;
  const sessionId = await d1
    .prepare("SELECT session_id FROM discord_authorization")
    .first<string>("session_id");

  expect(await store.consume(state, owner, sessionId!)).toBeTruthy();
  await store.disconnect(owner);
  await expect(
    store.link(state, owner, { id: "987654321", username: "discord-alice" }),
  ).rejects.toThrow();
  expect(await connection()).toBeNull();
});

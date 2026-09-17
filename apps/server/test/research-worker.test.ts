import { build } from "esbuild";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";
import { Miniflare, Request as WorkerRequest, Response as WorkerResponse } from "miniflare";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { createDb } from "@radar/db";
import { createProviderBudget } from "@radar/db/provider-budget";
import { ResearchDeferred } from "@radar/core/research";
import { createResearch } from "@radar/db/research";
import { createWorkspace } from "@radar/db/workspace";
import type { TaskInput } from "@radar/core";

const input: TaskInput = {
  title: "Hono releases",
  brief: "Find the latest stable Hono release from official notes.",
  category: "Technology",
  status: "active",
  frequency: "Daily",
  time: "09:00",
  language: "English",
  email: true,
  messages: [],
  revision: 0,
};
const source = "https://github.com/honojs/hono/releases/tag/v4.13.7";
const candidate = {
  title: "Hono 4.13.7",
  summary: "A stable release with a rendering fix.",
  reason: "An official stable release.",
  url: source,
  eventKey: "hono-release",
  version: "4.13.7",
};
let runtime: Miniflare;
let d1: Awaited<ReturnType<Miniflare["getD1Database"]>>;
let research: ReturnType<typeof createResearch>;
let workspace: ReturnType<typeof createWorkspace>;
let worker: Awaited<ReturnType<Miniflare["getWorker"]>>;
let mode:
  | "success"
  | "empty"
  | "search-error"
  | "bad-citation"
  | "cancel"
  | "mail-error"
  | "expand"
  | "partial"
  | "unreadable"
  | "unchanged"
  | "search-rate-limit";
let calls: {
  host: string;
  path: string;
  params: Record<string, string>;
  body: Record<string, unknown>;
  key: string | null;
}[];
let taskId: string;

beforeAll(async () => {
  const bundled = await build({
    stdin: {
      contents: `import worker from '../../apps/worker/src/index'; import {createAgent} from '@radar/agent'; export default {...worker, async fetch(req,env) { const {task,message}=await req.json(); return Response.json(await createAgent(env).compose(task,message)); }};`,
      resolveDir: fileURLToPath(new URL("../", import.meta.url)),
    },
    bundle: true,
    write: false,
    platform: "browser",
    format: "esm",
    conditions: ["workerd"],
    external: ["node:*"],
  });

  runtime = new Miniflare({
    modules: true,
    script: bundled.outputFiles[0]!.text,
    compatibilityDate: "2026-07-01",
    compatibilityFlags: ["nodejs_compat"],
    d1Databases: ["DB"],
    queueProducers: { RESEARCH_QUEUE: "research" },
    queueConsumers: { research: { maxBatchSize: 1, maxBatchTimeout: 0 } },
    bindings: {
      OPENAI_API_KEY: "test-model-key",
      OPENAI_BASE_URL: "https://model.example.com/v1",
      OPENAI_MODEL: "test-model",
      TINYFISH_API_KEY: "test-search-key",
      RESEND_API_KEY: "test-email-key",
      EMAIL_FROM: "radar@example.com",
      CORS_ORIGIN: "https://radar.example.com",
    },
    outboundService: async (request: WorkerRequest) => {
      const url = new URL(request.url);
      const body =
        request.method === "POST" ? ((await request.json()) as Record<string, unknown>) : {};

      calls.push({
        host: url.hostname,
        path: url.pathname,
        params: Object.fromEntries(url.searchParams),
        body,
        key: request.headers.get("Idempotency-Key"),
      });

      const json = (value: unknown, status = 200) =>
        new WorkerResponse(JSON.stringify(value), {
          status,
          headers: { "Content-Type": "application/json" },
        });

      if (url.hostname === "model.example.com") {
        const messages = body.messages as { role: string; content: string }[];
        const data = JSON.parse(messages[1]!.content.slice("Return JSON for this data:\n".length));
        const content = data.message
          ? {
              title: input.title,
              brief: input.brief,
              category: input.category,
              frequency: input.frequency,
              time: input.time,
              language: input.language,
              email: input.email,
              reply: "I will track official stable releases.",
            }
          : data.sources
            ? {
                summary: "One stable release.",
                needsMoreEvidence:
                  mode === "expand" &&
                  calls.filter((call) => call.host === "api.fetch.tinyfish.ai").length === 1,
                findings:
                  mode === "unchanged" ||
                  (mode === "expand" &&
                    calls.filter((call) => call.host === "api.fetch.tinyfish.ai").length === 1)
                    ? []
                    : [
                        {
                          ...candidate,
                          url:
                            mode === "bad-citation"
                              ? "https://unread.example.com/invented"
                              : source,
                        },
                      ],
              }
            : {
                queries:
                  mode === "expand"
                    ? data.previousQueries
                      ? [
                          { query: "Hono release announcement" },
                          { query: "Hono changelog" },
                          { query: "Hono stable versions" },
                        ]
                      : [
                          {
                            query: "Hono stable release notes",
                            include_domains: ["github.com"],
                            recency_minutes: 2880,
                          },
                          { query: "Hono official notes", location: "TR", language: "tr" },
                        ]
                    : [{ query: "Hono stable release notes" }],
              };

        return json({ choices: [{ message: { content: JSON.stringify(content) } }] });
      }

      if (url.hostname === "api.search.tinyfish.ai") {
        expect(request.headers.get("X-API-Key")).toBe("test-search-key");

        if (mode !== "expand")
          expect(url.searchParams.get("query")).toBe("Hono stable release notes");

        if (mode === "search-rate-limit")
          return new WorkerResponse("Rate limited", {
            status: 429,
            headers: { "Retry-After": "120" },
          });

        if (mode === "search-error") return json({ error: "Unavailable" }, 503);

        return json({
          results:
            mode === "empty"
              ? []
              : mode === "expand"
                ? [
                    { url: source, title: "Hono release", snippet: "Official stable release" },
                    ...Array.from({ length: 7 }, (_, i) => ({
                      url: `https://hono.dev/${url.searchParams.get("query")?.replaceAll(" ", "-")}/${i}`,
                      title: "Hono stable release notes",
                      snippet: "Official release notes",
                    })),
                  ]
                : [
                    {
                      url: source + "?utm_source=search",
                      title: "Hono release",
                      snippet: "Stable release",
                    },
                    { url: "http://127.0.0.1/private", title: "Ignore private URL" },
                    ...(mode === "partial"
                      ? [{ url: "https://hono.dev/unreadable", title: "More release notes" }]
                      : []),
                  ],
        });
      }

      if (url.hostname === "api.fetch.tinyfish.ai") {
        if (mode !== "expand" && mode !== "partial") expect(body.urls).toEqual([source]);

        expect(body.ttl).toBe(0);

        if (mode === "cancel")
          await d1.prepare("UPDATE task SET status = 'paused' WHERE id = ?").bind(taskId).run();

        return json({
          results:
            mode === "unreadable"
              ? []
              : (body.urls as string[])
                  .filter((url) => !url.endsWith("unreadable"))
                  .map((url) => ({
                    url,
                    final_url: url,
                    text: "# v4.13.7\nStable Hono release. Fixes rendering in boundary components.",
                  })),
          errors:
            mode === "unreadable" || mode === "partial"
              ? [{ url: "https://hono.dev/unreadable", error: "timeout" }]
              : [],
        });
      }

      if (url.hostname === "api.resend.com")
        return json(
          mode === "mail-error" ? { error: "Try again" } : { id: "sent-1" },
          mode === "mail-error" ? 503 : 200,
        );

      throw new Error(`Unexpected outbound host: ${url.hostname}`);
    },
  });
  d1 = await runtime.getD1Database("DB");
  worker = await runtime.getWorker();

  const folder = new URL("../../../packages/db/src/migrations/", import.meta.url);

  for (const file of (await readdir(folder)).filter((name) => name.endsWith(".sql")).sort()) {
    const sql = await readFile(new URL(file, folder), "utf8");

    await d1.batch(
      sql
        .split("--> statement-breakpoint")
        .filter((part) => part.trim())
        .map((part) => d1.prepare(part)),
    );
  }

  const db = createDb({ DB: d1 });

  research = createResearch(db);
  workspace = createWorkspace(db);
}, 30_000);
afterAll(async () => {
  await runtime?.dispose();
});
beforeEach(async () => {
  calls = [];
  mode = "success";
  await d1.prepare("DELETE FROM user").run();
  await d1.prepare("DELETE FROM provider_usage").run();
  await d1.prepare("DELETE FROM provider_backoff").run();
  await d1
    .prepare(
      "INSERT INTO user (id, name, email, email_verified, created_at, updated_at, username) VALUES ('owner', 'Owner', 'owner@example.com', 1, 0, 0, 'owner')",
    )
    .run();
  taskId = (await workspace.create("owner", input)).id;
});

async function consume(runId: string) {
  const result = await worker.queue("research", [
    { id: crypto.randomUUID(), timestamp: new Date(), attempts: 1, body: { runId } },
  ]);

  expect(result.outcome).toBe("ok");
}

const value = (table: string, column: string) =>
  d1.prepare(`SELECT ${column} FROM ${table}`).first(column);
const sent = () => calls.filter((call) => call.host === "api.resend.com");

it("composes tasks using the compatible model inside Workers", async () => {
  const response = await runtime.dispatchFetch("https://radar.example.com/compose", {
    method: "POST",
    body: JSON.stringify({ task: input, message: "Only stable releases" }),
  });

  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    title: input.title,
    messages: [{ role: "user", text: "Only stable releases" }, { role: "assistant" }],
  });
});
it("runs TinyFish search and fetch, saves cited findings, and delivers once across queue duplicates", async () => {
  const id = await research.start("owner", taskId);

  await consume(id);
  await consume(id);
  expect(await value("run", "status")).toBe("completed");
  expect(await value("run", "findings")).toBe(1);
  expect(await value("finding", "url")).toBe(source);
  expect(await value("delivery", "status")).toBe("sent");
  expect(sent()).toHaveLength(1);
  expect(sent()[0]!.body.text).toContain(source);
  expect(calls.filter((call) => call.host === "model.example.com")).toHaveLength(2);
});
it("finishes an empty search without inventing a finding or sending mail", async () => {
  mode = "empty";
  await consume(await research.start("owner", taskId));
  expect(await value("run", "status")).toBe("completed");
  expect(await value("run", "outcome")).toBe("unchanged");
  expect(await value("finding", "count(*)")).toBe(0);
  expect(calls.some((call) => call.host === "api.fetch.tinyfish.ai")).toBe(false);
  expect(sent()).toHaveLength(0);
});
it("rejects findings that cite an unread source", async () => {
  mode = "bad-citation";
  await consume(await research.start("owner", taskId));
  expect(await value("run", "status")).toBe("failed");
  expect(await value("finding", "count(*)")).toBe(0);
  expect(sent()).toHaveLength(0);
});
it("stops work when a task is paused during source reading", async () => {
  mode = "cancel";
  await consume(await research.start("owner", taskId));
  expect(await value("run", "status")).toBe("cancelled");
  expect(await value("finding", "count(*)")).toBe(0);
  expect(sent()).toHaveLength(0);
});
it("records a provider failure once even when the queue repeats the job", async () => {
  mode = "search-error";

  const id = await research.start("owner", taskId);

  await consume(id);
  await consume(id);
  expect(await value("run", "status")).toBe("failed");
  expect(await value("task", "failures")).toBe(1);
  expect(sent()).toHaveLength(0);
});
it("retries email with the same idempotency key without repeating the research", async () => {
  mode = "mail-error";
  await consume(await research.start("owner", taskId));
  expect(await value("delivery", "status")).toBe("pending");
  expect(sent()).toHaveLength(1);
  mode = "success";
  await d1.prepare("UPDATE delivery SET next_attempt = 0").run();
  expect((await worker.scheduled()).outcome).toBe("ok");
  expect(await value("delivery", "status")).toBe("sent");
  expect(sent()).toHaveLength(2);
  expect(sent()[0]!.key).toBe(sent()[1]!.key);
  expect(await value("run", "count(*)")).toBe(1);
});
it("schedules a due task through the actual queue consumer", async () => {
  expect((await worker.scheduled()).outcome).toBe("ok");
  await expect.poll(() => value("delivery", "status"), { timeout: 10_000 }).toBe("sent");
  expect(await value("run", "count(*)")).toBe(1);
  expect(Number(await value("task", "next_run_at"))).toBeGreaterThan(Date.now());
});

it("expands insufficient evidence within five searches and ten distinct page reads, forwarding filters", async () => {
  mode = "expand";
  await consume(await research.start("owner", taskId));

  const searches = calls.filter((call) => call.host === "api.search.tinyfish.ai");
  const reads = calls.filter((call) => call.host === "api.fetch.tinyfish.ai");
  const urls = reads.flatMap((call) => call.body.urls as string[]);

  expect(searches).toHaveLength(5);
  expect(reads).toHaveLength(2);
  expect(urls).toHaveLength(10);
  expect(new Set(urls).size).toBe(10);
  expect(searches[0]!.params).toMatchObject({
    include_domains: "github.com",
    recency_minutes: "2880",
  });
  expect(searches[1]!.params).toMatchObject({ location: "TR", language: "tr" });
  expect(reads[0]!.body.urls).toContain("https://hono.dev/Hono-official-notes/0");
  expect(await value("run", "coverage")).toBe("complete");
  expect(await value("finding", "count(*)")).toBe(1);
});
it("keeps valid findings while marking partial reads as incomplete", async () => {
  mode = "partial";
  await consume(await research.start("owner", taskId));
  expect(await value("run", "status")).toBe("completed");
  expect(await value("run", "coverage")).toBe("limited");
  expect(await value("finding", "count(*)")).toBe(1);
});
it("does not present unreadable sources as no new matches", async () => {
  mode = "unreadable";
  await consume(await research.start("owner", taskId));
  expect(await value("run", "coverage")).toBe("limited");
  expect(await value("run", "summary")).toContain("Research incomplete");
  expect(sent()).toHaveLength(0);
});
it("does not expand just because readable relevant sources contain no new events", async () => {
  mode = "unchanged";
  await consume(await research.start("owner", taskId));
  expect(calls.filter((call) => call.host === "api.fetch.tinyfish.ai")).toHaveLength(1);
  expect(await value("run", "coverage")).toBe("complete");
  expect(await value("run", "summary")).toBe("No new matches.");
});

it("enforces the shared search minute limit atomically across workers", async () => {
  const budget = await createProviderBudget(createDb({ DB: d1 }), "test-search-key");
  const now = Date.now();
  const requests = await Promise.allSettled(
    Array.from({ length: 12 }, () => budget.reserve("search", 3, now)),
  );

  expect(requests.filter((request) => request.status === "fulfilled")).toHaveLength(10);
  expect(await value("provider_usage", "sum(amount)")).toBe(30);
  await expect(budget.reserve("search", 1, now + 59_000)).rejects.toBeInstanceOf(ResearchDeferred);
  await expect(budget.reserve("search", 1, now + 61_000)).resolves.toBeUndefined();
});
it("defers a rate-limited check without failures, extra daily checks, or repeating its plan", async () => {
  const budget = await createProviderBudget(createDb({ DB: d1 }), "test-search-key");

  await budget.reserve("search", 30);

  const id = await research.start("owner", taskId);

  await consume(id);
  await consume(id);
  await research.expire(Date.now() + 700_000);
  expect(await value("run", "status")).toBe("running");
  expect(Number(await value("run", "retry_at"))).toBeGreaterThan(Date.now());
  expect(await value("task", "failures")).toBe(0);
  expect(calls.filter((call) => call.host === "api.search.tinyfish.ai")).toHaveLength(0);
  expect(calls.filter((call) => call.host === "model.example.com")).toHaveLength(1);

  await d1.prepare("DELETE FROM provider_usage").run();
  await d1.prepare("UPDATE run SET retry_at = 0").run();
  await consume(id);
  expect(await value("run", "status")).toBe("completed");
  expect(await value("run", "checkpoint")).toBeNull();
  expect(calls.filter((call) => call.host === "model.example.com")).toHaveLength(2);
  expect(await value("usage", "checks")).toBe(1);
});
it("resumes at page reading after the daily fetch budget becomes available", async () => {
  const budget = await createProviderBudget(createDb({ DB: d1 }), "test-search-key");

  await budget.reserve("fetch", 1);
  await d1
    .prepare("UPDATE provider_usage SET amount = 1000, created_at = ?")
    .bind(Date.now() - 3_600_000)
    .run();

  const id = await research.start("owner", taskId);

  await consume(id);
  expect(Number(await value("run", "retry_at"))).toBeGreaterThan(Date.now() + 22 * 3_600_000);
  expect(calls.filter((call) => call.host === "api.search.tinyfish.ai")).toHaveLength(1);
  expect(calls.filter((call) => call.host === "api.fetch.tinyfish.ai")).toHaveLength(0);
  await d1.prepare("DELETE FROM provider_usage WHERE service = 'fetch'").run();
  await d1.prepare("UPDATE run SET retry_at = 0").run();
  await consume(id);
  expect(await value("run", "status")).toBe("completed");
  expect(calls.filter((call) => call.host === "api.search.tinyfish.ai")).toHaveLength(1);
  expect(await value("usage", "checks")).toBe(1);
});
it("honors provider Retry-After across tasks and lets the user cancel waiting work", async () => {
  mode = "search-rate-limit";
  await consume(await research.start("owner", taskId));
  expect(Number(await value("run", "retry_at"))).toBeGreaterThan(Date.now() + 110_000);
  expect(await value("task", "failures")).toBe(0);

  const secondTask = await workspace.create("owner", input);

  await consume(await research.start("owner", secondTask.id));
  expect(calls.filter((call) => call.host === "api.search.tinyfish.ai")).toHaveLength(1);
  await workspace.update("owner", taskId, { ...input, status: "paused" });
  expect(
    await d1.prepare("SELECT status FROM run WHERE task_id = ?").bind(taskId).first("status"),
  ).toBe("cancelled");
  expect(
    await d1
      .prepare("SELECT checkpoint FROM run WHERE task_id = ?")
      .bind(taskId)
      .first("checkpoint"),
  ).toBeNull();
  expect(await research.queued()).toHaveLength(0);
});

it("keeps hourly search and per-minute URL limits separate, scoped to the provider key", async () => {
  const db = createDb({ DB: d1 });
  const budget = await createProviderBudget(db, "test-search-key");
  const now = Date.now();

  await budget.reserve("search", 1, now - 120_000);
  await d1.prepare("UPDATE provider_usage SET amount = 500 WHERE service = 'search'").run();
  await expect(budget.reserve("search", 1, now)).rejects.toMatchObject({
    retryAt: now - 120_000 + 3_600_000 + 1000,
  });
  await budget.reserve("fetch", 150, now);
  await expect(budget.reserve("fetch", 1, now)).rejects.toBeInstanceOf(ResearchDeferred);
  await expect(budget.reserve("fetch", 1, now + 61_000)).resolves.toBeUndefined();

  const otherKey = await createProviderBudget(db, "another-key");

  await expect(otherKey.reserve("search", 1, now)).resolves.toBeUndefined();
});

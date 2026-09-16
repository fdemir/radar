import { build } from "esbuild";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";
import { Miniflare, Request as WorkerRequest, Response as WorkerResponse } from "miniflare";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { createDb } from "@radar/db";
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
let mode: "success" | "empty" | "search-error" | "bad-citation" | "cancel" | "mail-error";
let calls: { host: string; path: string; body: Record<string, unknown>; key: string | null }[];
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
              language: input.language,
              reply: "I will track official stable releases.",
            }
          : data.sources
            ? {
                summary: "One stable release.",
                findings: [
                  {
                    ...candidate,
                    url: mode === "bad-citation" ? "https://unread.example.com/invented" : source,
                  },
                ],
              }
            : { queries: ["Hono stable release notes"] };

        return json({ choices: [{ message: { content: JSON.stringify(content) } }] });
      }

      if (url.hostname === "api.search.tinyfish.ai") {
        expect(request.headers.get("X-API-Key")).toBe("test-search-key");
        expect(url.searchParams.get("query")).toBe("Hono stable release notes");

        if (mode === "search-error") return json({ error: "Unavailable" }, 503);

        return json({
          results:
            mode === "empty"
              ? []
              : [
                  {
                    url: source + "?utm_source=search",
                    title: "Hono release",
                    snippet: "Stable release",
                  },
                  { url: "http://127.0.0.1/private", title: "Ignore private URL" },
                ],
        });
      }

      if (url.hostname === "api.fetch.tinyfish.ai") {
        expect(body.urls).toEqual([source]);
        expect(body.ttl).toBe(0);

        if (mode === "cancel")
          await d1.prepare("UPDATE task SET status = 'paused' WHERE id = ?").bind(taskId).run();

        return json({
          results: [
            {
              url: source,
              final_url: source,
              text: "# v4.13.7\nStable Hono release. Fixes rendering in boundary components.",
            },
          ],
          errors: [],
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

import { build } from "esbuild";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";
import { Miniflare, Request as WorkerRequest, Response as WorkerResponse } from "miniflare";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { composeEventSchema, readEventData } from "@radar/core/stream";
import type { TaskInput } from "@radar/core";

const origin = "https://radar.example.com";
const input: TaskInput = {
  title: "",
  brief: "",
  category: "Other",
  status: "draft",
  frequency: "Daily",
  time: "09:00",
  language: "English",
  email: false,
  messages: [],
  revision: 0,
};
const reply = 'Track **Hono** releases.\nOnly stable versions, including "İstanbul" notes.';
const details = {
  reply,
  title: "Hono releases",
  brief: "Track stable Hono releases from official GitHub notes.",
  category: "Technology",
  frequency: "Daily",
  time: "10:30",
  language: "English",
  email: false,
};
let runtime: Miniflare;
let d1: Awaited<ReturnType<Miniflare["getD1Database"]>>;
let cookie: string;
let mode: "success" | "interrupted" | "invalid" | "unavailable";
let release: (() => void) | undefined;
let modelFinished: boolean;
let calls: number;

beforeAll(async () => {
  const bundle = await build({
    stdin: {
      contents: `import {createApp} from './src/app'; import {createAuth} from '@radar/auth'; import {createDb} from '@radar/db'; import {createAgent} from '@radar/agent'; export default { fetch(request,env) {const db=createDb(env);return createApp(createAuth(env,db),env.CORS_ORIGIN,db,{agent:createAgent(env),emailAvailable:false,enqueue:async()=>{}}).fetch(request,env);}}`,
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
    modules: [{ type: "ESModule", path: "worker.mjs", contents: bundle.outputFiles[0]!.text }],
    compatibilityDate: "2026-07-01",
    compatibilityFlags: ["nodejs_compat"],
    d1Databases: ["DB"],
    bindings: {
      BETTER_AUTH_URL: origin,
      BETTER_AUTH_SECRET: "stream-test-secret-at-least-32-characters",
      CORS_ORIGIN: origin,
      OPENAI_API_KEY: "model-test-key",
      OPENAI_BASE_URL: "https://model.example.com/v1",
      OPENAI_MODEL: "test-model",
      TINYFISH_API_KEY: "search-test-key",
    },
    outboundService: async (request: WorkerRequest) => {
      expect(new URL(request.url).hostname).toBe("model.example.com");

      const body = (await request.json()) as { stream: boolean };

      expect(body.stream).toBe(true);
      calls++;

      if (mode === "unavailable") return new WorkerResponse("Unavailable", { status: 503 });

      const content = JSON.stringify(
        mode === "invalid" ? { ...details, frequency: "Every minute" } : details,
      );
      const encoder = new TextEncoder();
      const event = (content: string, finish: string | null = null) =>
        `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: finish }] })}\r\n\r\n`;
      const bodyStream = new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(encoder.encode(": keepalive\r\n\r\n" + event(content.slice(0, 26))));
          await new Promise<void>((resolve) => {
            release = resolve;
          });

          const rest = encoder.encode(
            event(content.slice(26)) +
              (mode === "interrupted" ? "" : event("", "stop") + "data: [DONE]\r\n\r\n"),
          );

          // Split every UTF-8 byte, SSE delimiter and JSON escape across network chunks.
          for (const byte of rest) controller.enqueue(new Uint8Array([byte]));

          modelFinished = true;
          controller.close();
        },
      });

      return new WorkerResponse(bodyStream, { headers: { "Content-Type": "text/event-stream" } });
    },
  });
  d1 = await runtime.getD1Database("DB");

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

  const response = await runtime.dispatchFetch(origin + "/api/auth/sign-up/email", {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({
      username: "stream_test",
      name: "Stream Test",
      email: "stream@example.com",
      password: "stream-test-password",
    }),
  });

  expect(response.status).toBe(200);
  cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
}, 30_000);

afterAll(async () => {
  release?.();
  await runtime?.dispose();
});

beforeEach(async () => {
  await d1.prepare("DELETE FROM rate_limit").run();
  mode = "success";
  release = undefined;
  modelFinished = false;
  calls = 0;
});

function request(session = cookie, requestOrigin = origin, task = input) {
  return runtime.dispatchFetch(origin + "/api/tasks/compose", {
    method: "POST",
    headers: {
      Origin: requestOrigin,
      Cookie: session,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify({ task, message: "Only stable Hono releases at 10:30" }),
  });
}

it("streams visible reply text before the provider finishes, then sends one validated task", async () => {
  const response = await request();

  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toContain("text/event-stream");
  expect(response.headers.get("Cache-Control")).toContain("no-store");

  const events = readEventData(response.body!);
  const first = await events.next();

  expect(JSON.parse(first.value!)).toMatchObject({
    type: "reply",
    text: expect.stringContaining("Track"),
  });
  expect(modelFinished).toBe(false);
  release!();

  const rest = [];

  for await (const data of events) rest.push(composeEventSchema.parse(JSON.parse(data)));

  expect(rest.filter((event) => event.type === "complete")).toHaveLength(1);
  expect(rest.at(-1)).toMatchObject({
    type: "complete",
    task: {
      title: details.title,
      time: "10:30",
      messages: [{ role: "user" }, { role: "assistant", text: reply }],
    },
  });
  expect(await d1.prepare("SELECT count(*) AS n FROM task").first("n")).toBe(0);
});

it.each(["interrupted", "invalid"] as const)("does not apply a %s response", async (failure) => {
  mode = failure;

  const response = await request();
  const events = readEventData(response.body!);

  await events.next();
  release!();

  const rest = [];

  for await (const data of events) rest.push(composeEventSchema.parse(JSON.parse(data)));

  expect(rest.some((event) => event.type === "complete")).toBe(false);
  expect(rest.at(-1)).toMatchObject({ type: "error" });
});

it("returns a visible stream error when the model is unavailable", async () => {
  mode = "unavailable";

  const response = await request();
  const events = [];

  for await (const data of readEventData(response.body!)) events.push(JSON.parse(data));

  expect(events).toEqual([{ type: "error", message: "Unable to finish the reply. Try again." }]);
});

it("rejects unauthenticated, foreign-origin, overlong and rate-limited streams before calling the model", async () => {
  expect((await request("")).status).toBe(401);
  expect((await request(cookie, "https://other.example.com")).status).toBe(403);
  expect(
    (
      await request(cookie, origin, {
        ...input,
        messages: Array.from({ length: 80 }, () => ({ role: "user" as const, text: "Hello" })),
      })
    ).status,
  ).toBe(400);

  const userId = await d1.prepare("SELECT id FROM user WHERE username = 'stream_test'").first("id");

  await d1
    .prepare("INSERT INTO rate_limit (id, key, count, last_request) VALUES (?, ?, 30, ?)")
    .bind(
      crypto.randomUUID(),
      `compose:${userId}:${Math.floor(Date.now() / 3_600_000)}`,
      Date.now(),
    )
    .run();
  expect((await request()).status).toBe(429);
  expect(calls).toBe(0);
});

import { parseEnv } from "node:util";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { context } from "esbuild";
import { Miniflare } from "miniflare";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const cache = resolve(root, ".cache/local");

await mkdir(cache, { recursive: true });

const secretPath = resolve(cache, "auth-secret");
let secret;

try {
  secret = await readFile(secretPath, "utf8");
} catch (error) {
  if (error.code !== "ENOENT") throw error;

  secret = randomBytes(32).toString("hex");
  await writeFile(secretPath, secret, { mode: 0o600 });
}

const workerPath = resolve(cache, "worker.mjs");
const port = Number(process.env.PORT || 3000);
const localEnv = parseEnv(
  await readFile(resolve(root, "apps/server/.env"), "utf8").catch(() => ""),
);
const bindings = {
  BETTER_AUTH_SECRET: secret,
  BETTER_AUTH_URL: `http://localhost:${port}`,
  CORS_ORIGIN: process.env.CORS_ORIGIN || "http://localhost:5174",
  OPENAI_API_KEY: localEnv.OPENAI_API_KEY || "",
  OPENAI_BASE_URL: localEnv.OPENAI_BASE_URL || "https://api.openai.com/v1",
  OPENAI_MODEL: localEnv.OPENAI_MODEL || "gpt-5.6-luna",
  TINYFISH_API_KEY: localEnv.TINYFISH_API_KEY || "",
  RESEND_API_KEY: localEnv.RESEND_API_KEY || "",
  EMAIL_FROM: localEnv.EMAIL_FROM || "",
};
const shared = {
  modulesRoot: root,
  compatibilityDate: "2026-07-01",
  compatibilityFlags: ["nodejs_compat"],
  d1Databases: ["DB"],
  queueProducers: { RESEARCH_QUEUE: "research" },
  bindings,
};
const options = {
  host: "127.0.0.1",
  port,
  unsafeTriggerHandlers: true,
  d1Persist: resolve(cache, "d1"),
  queuePersist: resolve(cache, "queues"),
  workers: [
    { ...shared, name: "api", modules: [{ type: "ESModule", path: workerPath }] },
    {
      ...shared,
      name: "research",
      modules: [{ type: "ESModule", path: resolve(cache, "research.mjs") }],
      routes: ["research.local/*"],
      queueConsumers: { research: { maxBatchSize: 1, maxBatchTimeout: 1, maxRetries: 2 } },
    },
  ],
};
let runtime;
const build = await context({
  entryPoints: {
    worker: resolve(root, "apps/server/src/index.ts"),
    research: resolve(root, "apps/worker/src/index.ts"),
  },
  bundle: true,
  format: "esm",
  platform: "browser",
  conditions: ["workerd"],
  external: ["cloudflare:workers", "node:*"],
  outdir: cache,
  outExtension: { ".js": ".mjs" },
  plugins: [
    {
      name: "reload-local-worker",
      setup(builder) {
        builder.onEnd(async (result) => {
          if (runtime && !result.errors.length) await runtime.setOptions(options);
        });
      },
    },
  ],
});

await build.rebuild();
runtime = new Miniflare(options);

try {
  const db = await runtime.getD1Database("DB", "api");

  await db.prepare("CREATE TABLE IF NOT EXISTS _radar_migrations (name TEXT PRIMARY KEY)").run();

  const directory = resolve(root, "packages/db/src/migrations");

  for (const file of (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort()) {
    if (await db.prepare("SELECT name FROM _radar_migrations WHERE name = ?").bind(file).first())
      continue;

    const sql = await readFile(resolve(directory, file), "utf8");

    await db.batch([
      ...sql
        .split("--> statement-breakpoint")
        .filter((part) => part.trim())
        .map((part) => db.prepare(part)),
      db.prepare("INSERT INTO _radar_migrations (name) VALUES (?)").bind(file),
    ]);
  }

  await build.watch();
  console.log(`Radar local API: http://localhost:${port}`);
} catch (error) {
  await runtime.dispose();
  await build.dispose();
  throw error;
}

let ticking = false;
const schedule = setInterval(async () => {
  if (ticking) return;

  ticking = true;

  try {
    const response = await runtime.dispatchFetch("http://research.local/cdn-cgi/handler/scheduled");

    if (!response.ok) console.error("Local scheduler failed:", response.status);
  } catch {
    console.error("Local scheduler is unavailable.");
  } finally {
    ticking = false;
  }
}, 60_000);
let stopping = false;

async function stop() {
  if (stopping) return;

  stopping = true;
  clearInterval(schedule);
  await build.dispose();
  await runtime.dispose();
  process.exit(0);
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);

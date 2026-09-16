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
const options = {
  modulesRoot: root,
  modules: [{ type: "ESModule", path: workerPath }],
  compatibilityDate: "2026-07-01",
  compatibilityFlags: ["nodejs_compat"],
  host: "127.0.0.1",
  port,
  d1Databases: ["DB"],
  d1Persist: resolve(cache, "d1"),
  bindings: {
    BETTER_AUTH_SECRET: secret,
    BETTER_AUTH_URL: `http://localhost:${port}`,
    CORS_ORIGIN: process.env.CORS_ORIGIN || "http://localhost:5174",
  },
};
let runtime;
const build = await context({
  entryPoints: [resolve(root, "apps/server/src/index.ts")],
  bundle: true,
  format: "esm",
  platform: "browser",
  conditions: ["workerd"],
  external: ["cloudflare:workers", "node:*"],
  outfile: workerPath,
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
  const db = await runtime.getD1Database("DB");
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
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await build.dispose();
  await runtime.dispose();
  process.exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

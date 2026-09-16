import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import "varlock/auto-load";

import { prepareMigrations } from "./migrations";

export const db = Cloudflare.D1.Database(
  "database",
  Effect.promise(prepareMigrations).pipe(Effect.map((migrations) => ({ migrations }))),
);

export const researchQueue = Cloudflare.Queues.Queue("research-queue");

const services = {
  OPENAI_API_KEY: Config.redacted("OPENAI_API_KEY"),
  OPENAI_BASE_URL: Config.string("OPENAI_BASE_URL"),
  OPENAI_MODEL: Config.string("OPENAI_MODEL"),
  TINYFISH_API_KEY: Config.redacted("TINYFISH_API_KEY"),
  RESEND_API_KEY: Config.redacted("RESEND_API_KEY").pipe(Config.withDefault(Redacted.make(""))),
  EMAIL_FROM: Config.string("EMAIL_FROM").pipe(Config.withDefault("")),
};

export const researchWorker = Cloudflare.Worker("research", {
  main: "../../apps/worker/src/index.ts",
  compatibility: { flags: ["nodejs_compat"] },
  crons: ["* * * * *"],
  env: {
    DB: db,
    RESEARCH_QUEUE: researchQueue,
    CORS_ORIGIN: Config.string("CORS_ORIGIN"),
    ...services,
  },
  dev: { port: 3001 },
});

export const server = Cloudflare.Worker("server", {
  main: "../../apps/server/src/index.ts",
  compatibility: {
    flags: ["nodejs_compat"],
  },
  env: {
    DB: db,
    RESEARCH_QUEUE: researchQueue,
    ...services,
    CORS_ORIGIN: Config.string("CORS_ORIGIN"),
    BETTER_AUTH_SECRET: Config.redacted("BETTER_AUTH_SECRET"),
    BETTER_AUTH_URL: Cloudflare.Worker.URL,
  },
  dev: {
    port: 3000,
  },
});

export type ServerEnv = Cloudflare.InferEnv<typeof server>;

export default Alchemy.Stack(
  "radar",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const stage = yield* Alchemy.Stage;
    const serverWorker = yield* server;
    const worker = yield* researchWorker;
    const queue = yield* researchQueue;

    yield* Cloudflare.Queues.Consumer("research-consumer", {
      queueId: queue.queueId,
      scriptName: worker.workerName,
      settings: { batchSize: 1, maxConcurrency: 2, maxRetries: 2, maxWaitTimeMs: 1000 },
    });

    const webWorker = yield* Cloudflare.Website.Vite("web", {
      name: `radar-${stage}`,
      rootDir: "../../apps/web",
      main: "workers/app.ts",
      memo: {
        include: ["**/*", "../../packages/ui/src/**", "../../packages/core/src/**"],
        lockfile: true,
      },
      compatibility: {
        flags: ["nodejs_compat"],
      },
      env: {
        VITE_SERVER_URL: serverWorker.url.as<string>(),
      },
      dev: {
        port: 5173,
      },
    });

    return {
      web: webWorker.url,
      server: serverWorker.url,
    };
  }),
);

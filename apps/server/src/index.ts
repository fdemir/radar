import { createAgent } from "@radar/agent";
import { createAuth } from "@radar/auth";
import { createDb } from "@radar/db";
import { createEmail } from "@radar/notifications";
import { createApp } from "./app";
import { env } from "./env.server";

const db = createDb(env);
const email = createEmail(env);

export default createApp(
  createAuth(env, db, [], email.available ? email : undefined),
  env.CORS_ORIGIN,
  db,
  {
    emailAvailable: email.available,
    agent: env.OPENAI_API_KEY && env.TINYFISH_API_KEY ? createAgent(env) : undefined,
    enqueue: (runId) => env.RESEARCH_QUEUE.send({ runId }),
  },
);

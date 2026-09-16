import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

import { env } from "./env.server";
import { createAuth } from "./services";

const app = new Hono();

app.use(logger());
app.use(
  "/*",
  cors({
    origin: env.CORS_ORIGIN,
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);

app.on(["POST", "GET"], "/api/auth/*", async (c) => (await createAuth()).handler(c.req.raw));

app.get("/", (c) => {
  return c.text("OK");
});

export default app;

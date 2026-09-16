import type { Database } from "@radar/db";
import { workspaceRoutes } from "./workspace";
import type { createAuth } from "@radar/auth";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

export function createApp(auth: ReturnType<typeof createAuth>, origin: string, db: Database) {
  const app = new Hono();

  app.use(logger());
  app.use(
    "/*",
    cors({
      origin,
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization"],
      credentials: true,
    }),
  );

  app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));
  app.get("/api/me", async (c) => {
    c.header("Cache-Control", "no-store");
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: "Authentication required" }, 401);
    return c.json({
      user: {
        id: session.user.id,
        username: session.user.username,
      },
    });
  });
  app.route("/api", workspaceRoutes(auth, origin, db));
  app.get("/", (c) => c.text("OK"));

  return app;
}

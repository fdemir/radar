import type { Database } from "@radar/db";
import { workspaceRoutes, type Services } from "./workspace";
import type { createAuth } from "@radar/auth";
import { discordRoutes } from "./discord";
import { webhookRoutes } from "./webhook";
import { Hono } from "hono";
import { cors } from "hono/cors";

export function createApp(
  auth: ReturnType<typeof createAuth>,
  origin: string,
  db: Database,
  services?: Services,
) {
  const app = new Hono();

  app.use(
    "/*",
    cors({
      origin,
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization"],
      credentials: true,
    }),
  );

  app.on(["POST", "GET"], "/api/auth/*", (c) => {
    if (
      services &&
      !services.emailAvailable &&
      ["/api/auth/send-verification-email", "/api/auth/request-password-reset"].includes(c.req.path)
    ) {
      return c.json(
        { error: "Email is not available yet.", message: "Email is not available yet." },
        503,
      );
    }

    return auth.handler(c.req.raw);
  });
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
  app.route("/api/discord", discordRoutes(auth, db, origin, services?.discord));
  app.route("/api/webhook", webhookRoutes(auth, db, origin));
  app.route("/api", workspaceRoutes(auth, origin, db, services));
  app.get("/", (c) => c.text("OK"));

  return app;
}

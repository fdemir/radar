import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { createAuth } from "@radar/auth";
import type { Database } from "@radar/db";
import { createDiscordConnections } from "@radar/db/discord";
import { WorkspaceError } from "@radar/db/workspace";
import { deliverDiscord, type Discord } from "@radar/notifications";

export function discordRoutes(
  auth: ReturnType<typeof createAuth>,
  db: Database,
  origin: string,
  discord?: Discord,
) {
  const routes = new Hono<{ Variables: { userId: string; sessionId: string } }>();
  const connections = createDiscordConnections(db);
  const destination = (result: string) => `${origin}/settings?discord=${result}`;

  routes.use("*", bodyLimit({ maxSize: 1024 }));
  routes.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    c.header("Referrer-Policy", "no-referrer");

    if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method) && c.req.header("Origin") !== origin)
      return c.json({ error: "Invalid request origin." }, 403);

    const session = await auth.api.getSession({ headers: c.req.raw.headers });

    if (!session)
      return c.req.path.endsWith("/callback")
        ? c.redirect(destination("session-expired"))
        : c.json({ error: "Authentication required" }, 401);

    c.set("userId", session.user.id);
    c.set("sessionId", session.session.id);
    await next();
  });
  routes.onError((error, c) => {
    if (error instanceof WorkspaceError) return c.json({ error: error.message }, error.status);

    return c.json({ error: "Unable to update Discord. Try again." }, 500);
  });

  async function allowed(userId: string, action: string, limit: number) {
    const now = Date.now();
    const key = `discord:${action}:${userId}`;

    return db.$client
      .prepare(
        `INSERT INTO rate_limit (id, key, count, last_request) VALUES (?, ?, 1, ?)
      ON CONFLICT(key) DO UPDATE SET count = CASE WHEN last_request < ? THEN 1 ELSE count + 1 END, last_request = ?
      WHERE last_request < ? OR count < ? RETURNING count`,
      )
      .bind(crypto.randomUUID(), key, now, now - 60_000, now, now - 60_000, limit)
      .first();
  }

  routes.get("/", async (c) =>
    c.json({
      available: discord?.available ?? false,
      connection: await connections.status(c.get("userId")),
    }),
  );
  routes.post("/connect", async (c) => {
    if (!discord?.available) return c.json({ error: "Discord is not available yet." }, 503);

    if (!(await allowed(c.get("userId"), "connect", 5)))
      return c.json({ error: "Too many connection attempts. Wait a minute and try again." }, 429);

    return c.json({
      url: discord.authorizationUrl(await connections.begin(c.get("userId"), c.get("sessionId"))),
    });
  });
  routes.get("/callback", async (c) => {
    const state = c.req.query("state");

    if (!discord?.available) return c.redirect(destination("unavailable"));

    if (
      !state ||
      state.length > 200 ||
      !(await connections.consume(state, c.get("userId"), c.get("sessionId")))
    )
      return c.redirect(destination("expired"));

    try {
      if (c.req.query("error")) return c.redirect(destination("cancelled"));

      const code = c.req.query("code");

      if (!code || code.length > 2000) return c.redirect(destination("failed"));

      const profile = await discord.identify(code);
      const connectionId = await connections.link(state, c.get("userId"), profile);

      // Persist the welcome first so the scheduler can recover if this request stops.
      await deliverDiscord(db, discord, origin, connectionId);

      return c.redirect(destination("linked"));
    } catch (error) {
      return c.redirect(destination(error instanceof WorkspaceError ? "conflict" : "failed"));
    } finally {
      await connections.forget(state);
    }
  });
  routes.delete("/", async (c) => {
    await connections.disconnect(c.get("userId"));

    return c.body(null, 204);
  });
  routes.patch("/", async (c) => {
    const body = await c.req.json().catch(() => null);

    if (!body || typeof body.enabled !== "boolean")
      return c.json({ error: "Choose whether Discord notifications are enabled." }, 400);

    await connections.enable(c.get("userId"), body.enabled);

    return c.body(null, 204);
  });
  routes.post("/test", async (c) => {
    if (!discord?.available) return c.json({ error: "Discord is not available yet." }, 503);

    if (!(await allowed(c.get("userId"), "test", 1)))
      return c.json({ error: "Wait a minute before sending another test message." }, 429);

    const { connectionId, deliveryId } = await connections.test(c.get("userId"));

    await deliverDiscord(db, discord, origin, connectionId);

    return c.json({
      available: true,
      connection: await connections.status(c.get("userId")),
      deliveryStatus: await db.$client
        .prepare("SELECT status FROM discord_delivery WHERE id = ?")
        .bind(deliveryId)
        .first("status"),
    });
  });

  return routes;
}

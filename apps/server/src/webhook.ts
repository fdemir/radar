import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import z from "zod";
import type { createAuth } from "@radar/auth";
import type { Database } from "@radar/db";
import { createWebhookConnections } from "@radar/db/webhook";
import { WorkspaceError } from "@radar/db/workspace";
import { webhookUrlSchema } from "@radar/core/webhook";
import { deliverWebhooks } from "@radar/notifications";

export function webhookRoutes(auth: ReturnType<typeof createAuth>, db: Database, origin: string) {
  const routes = new Hono<{ Variables: { userId: string } }>();
  const connections = createWebhookConnections(db);

  routes.use("*", bodyLimit({ maxSize: 4096 }));
  routes.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");

    if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method) && c.req.header("Origin") !== origin)
      return c.json({ error: "Invalid request origin." }, 403);

    const session = await auth.api.getSession({ headers: c.req.raw.headers });

    if (!session) return c.json({ error: "Authentication required" }, 401);

    c.set("userId", session.user.id);
    await next();
  });
  routes.onError((error, c) => {
    if (error instanceof WorkspaceError) return c.json({ error: error.message }, error.status);

    return c.json({ error: "Unable to update webhook. Try again." }, 500);
  });
  routes.get("/", async (c) => c.json({ connection: await connections.status(c.get("userId")) }));
  routes.put("/", async (c) => {
    const parsed = z
      .object({ url: webhookUrlSchema })
      .safeParse(await c.req.json().catch(() => null));

    if (!parsed.success)
      return c.json(
        { error: "Enter a public HTTPS URL without credentials, a fragment, or a custom port." },
        400,
      );

    const secret = await connections.save(c.get("userId"), new URL(parsed.data.url).href);

    return c.json({ secret, connection: await connections.status(c.get("userId")) });
  });
  routes.delete("/", async (c) => {
    await connections.disconnect(c.get("userId"));

    return c.body(null, 204);
  });
  routes.patch("/", async (c) => {
    const parsed = z
      .object({ enabled: z.boolean() })
      .safeParse(await c.req.json().catch(() => null));

    if (!parsed.success)
      return c.json({ error: "Choose whether webhook notifications are enabled." }, 400);

    await connections.enable(c.get("userId"), parsed.data.enabled);

    return c.body(null, 204);
  });
  routes.post("/test", async (c) => {
    const now = Date.now();
    const allowed = await db.$client
      .prepare(
        `INSERT INTO rate_limit (id, key, count, last_request) VALUES (?, ?, 1, ?)
      ON CONFLICT(key) DO UPDATE SET last_request = excluded.last_request WHERE last_request <= ? RETURNING id`,
      )
      .bind(crypto.randomUUID(), `webhook:test:${c.get("userId")}`, now, now - 60_000)
      .first();

    if (!allowed) return c.json({ error: "Wait a minute before sending another test." }, 429);

    const { id, connectionId } = await connections.test(c.get("userId"));

    await deliverWebhooks(db, origin, connectionId);

    return c.json({
      connection: await connections.status(c.get("userId")),
      deliveryStatus: await db.$client
        .prepare("SELECT status FROM webhook_delivery WHERE id = ?")
        .bind(id)
        .first("status"),
    });
  });

  return routes;
}

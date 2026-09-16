import type { createAuth } from "@radar/auth";
import { preferencesInputSchema, taskInputSchema } from "@radar/core";
import type { Database } from "@radar/db";
import { createWorkspace, WorkspaceError } from "@radar/db/workspace";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { bodyLimit } from "hono/body-limit";
import { validator } from "hono/validator";
import z from "zod";
import type { createAgent } from "@radar/agent";
import { createResearch } from "@radar/db/research";

export type Services = {
  agent?: ReturnType<typeof createAgent>;
  enqueue: (runId: string) => Promise<unknown>;
  emailAvailable: boolean;
};

function json<T extends z.ZodType>(schema: T) {
  return validator("json", (value, c) => {
    const parsed = schema.safeParse(value);

    if (!parsed.success)
      return c.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, 400);

    return parsed.data as z.output<T>;
  });
}

export function workspaceRoutes(
  auth: ReturnType<typeof createAuth>,
  origin: string,
  db: Database,
  services?: Services,
) {
  const routes = new Hono<{ Variables: { userId: string } }>();
  const workspace = createWorkspace(db);
  const research = createResearch(db);

  async function enqueue(userId: string, id: string) {
    if (!services?.agent) return;

    try {
      const runId = await research.start(userId, id);

      // The scheduler republishes committed runs if queue delivery fails.
      await services.enqueue(runId).catch(() => {});
    } catch (error) {
      if (!(error instanceof WorkspaceError)) throw error;
    }
  }

  routes.use("*", bodyLimit({ maxSize: 400_000 }));
  routes.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");

    if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method) && c.req.header("Origin") !== origin) {
      return c.json({ error: "Invalid request origin." }, 403);
    }

    const session = await auth.api.getSession({ headers: c.req.raw.headers });

    if (!session) return c.json({ error: "Authentication required" }, 401);

    c.set("userId", session.user.id);
    await next();
  });
  routes.onError((error, c) => {
    if (error instanceof WorkspaceError) return c.json({ error: error.message }, error.status);

    if (error instanceof HTTPException) return c.json({ error: error.message }, error.status);

    console.error("Workspace request failed", error.name);

    return c.json({ error: "Unable to save changes. Try again." }, 500);
  });
  routes.get("/workspace", async (c) =>
    c.json({
      ...(await workspace.snapshot(c.get("userId"))),
      emailAvailable: services?.emailAvailable ?? false,
      researchAvailable: Boolean(services?.agent),
    }),
  );
  routes.post(
    "/tasks/compose",
    json(z.object({ task: taskInputSchema, message: z.string().trim().min(1).max(2000) })),
    async (c) => {
      if (!services?.agent) return c.json({ error: "Research is not available yet." }, 503);

      const { task, message } = c.req.valid("json");

      if (task.messages.length > 78)
        return c.json({ error: "Conversation limit reached. Edit the brief directly." }, 400);

      const key = `compose:${c.get("userId")}:${Math.floor(Date.now() / 3_600_000)}`;
      const allowed = await db.$client
        .prepare(
          `INSERT INTO rate_limit (id, key, count, last_request) VALUES (?, ?, 1, ?)
      ON CONFLICT(key) DO UPDATE SET count = count + 1 WHERE count < 30 RETURNING count`,
        )
        .bind(crypto.randomUUID(), key, Date.now())
        .first();

      if (!allowed) return c.json({ error: "Too many setup messages. Try again later." }, 429);

      try {
        return c.json(await services.agent.compose(task, message));
      } catch {
        return c.json({ error: "Unable to update the brief. Try again." }, 502);
      }
    },
  );
  routes.post("/tasks/:id/run", async (c) => {
    if (!services?.agent) return c.json({ error: "Research is not available yet." }, 503);

    const id = await research.start(c.get("userId"), c.req.param("id"));

    await services.enqueue(id).catch(() => {});

    return c.json({ id }, 202);
  });
  routes.post("/tasks", json(taskInputSchema), async (c) => {
    const task = await workspace.create(c.get("userId"), c.req.valid("json"));

    if (task.status === "active") await enqueue(c.get("userId"), task.id);

    return c.json({ id: task.id }, 201);
  });
  routes.put("/tasks/:id", json(taskInputSchema), async (c) => {
    const task = await workspace.update(c.get("userId"), c.req.param("id"), c.req.valid("json"));

    if (task.status === "active") await enqueue(c.get("userId"), task.id);

    return c.json({ id: c.req.param("id") });
  });
  routes.delete("/tasks/:id", async (c) => {
    await workspace.remove(c.get("userId"), c.req.param("id"));

    return c.body(null, 204);
  });
  routes.patch("/preferences", json(preferencesInputSchema), async (c) => {
    await workspace.preferences(c.get("userId"), c.req.valid("json"));

    return c.body(null, 204);
  });
  routes.patch(
    "/findings/:id",
    json(z.object({ read: z.boolean().optional(), saved: z.boolean().optional() }).strict()),
    async (c) => {
      const patch = c.req.valid("json");
      const result = await db.$client
        .prepare(
          `UPDATE finding SET read = coalesce(?, read), saved = coalesce(?, saved)
      WHERE id = ? AND task_id IN (SELECT id FROM task WHERE user_id = ?) RETURNING id`,
        )
        .bind(
          patch.read === undefined ? null : Number(patch.read),
          patch.saved === undefined ? null : Number(patch.saved),
          c.req.param("id"),
          c.get("userId"),
        )
        .first();

      return result ? c.body(null, 204) : c.json({ error: "Finding not found." }, 404);
    },
  );
  routes.post("/findings/read", async (c) => {
    await db.$client
      .prepare(
        "UPDATE finding SET read = 1 WHERE task_id IN (SELECT id FROM task WHERE user_id = ?)",
      )
      .bind(c.get("userId"))
      .run();

    return c.body(null, 204);
  });
  routes.post("/notices/read", json(z.object({ id: z.string().optional() })), async (c) => {
    await db.$client
      .prepare(
        "UPDATE delivery SET read = 1 WHERE (? IS NULL OR id = ?) AND task_id IN (SELECT id FROM task WHERE user_id = ?)",
      )
      .bind(c.req.valid("json").id ?? null, c.req.valid("json").id ?? null, c.get("userId"))
      .run();

    return c.body(null, 204);
  });

  return routes;
}

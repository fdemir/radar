import type { createAuth } from "@radar/auth";
import { preferencesInputSchema, taskInputSchema } from "@radar/core";
import type { Database } from "@radar/db";
import { createWorkspace, WorkspaceError } from "@radar/db/workspace";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { bodyLimit } from "hono/body-limit";
import { validator } from "hono/validator";
import type z from "zod";

function json<T extends z.ZodType>(schema: T) {
  return validator("json", (value, c) => {
    const parsed = schema.safeParse(value);
    if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, 400);
    return parsed.data as z.output<T>;
  });
}

export function workspaceRoutes(auth: ReturnType<typeof createAuth>, origin: string, db: Database) {
  const routes = new Hono<{ Variables: { userId: string } }>();
  const workspace = createWorkspace(db);
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
  routes.get("/workspace", async (c) => c.json(await workspace.snapshot(c.get("userId"))));
  routes.post("/tasks", json(taskInputSchema), async (c) => {
    const task = await workspace.create(c.get("userId"), c.req.valid("json"));
    return c.json({ id: task.id }, 201);
  });
  routes.put("/tasks/:id", json(taskInputSchema), async (c) => {
    await workspace.update(c.get("userId"), c.req.param("id"), c.req.valid("json"));
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
  return routes;
}

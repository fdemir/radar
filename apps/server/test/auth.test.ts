import { URL } from "node:url";
import z from "zod";
import { readFile } from "node:fs/promises";
import { createAuth, type AuthConfig } from "@radar/auth";
import { createDb } from "@radar/db";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app";

const config: AuthConfig = {
  BETTER_AUTH_URL: "http://localhost:3000",
  BETTER_AUTH_SECRET: "local-test-secret-only-32-characters-long",
  CORS_ORIGIN: "http://localhost:5173",
};
const accountResponse = z.object({
  user: z.object({ id: z.string(), username: z.string() }),
});
const password = "test-password-123";
let runtime: Miniflare;
let d1: Awaited<ReturnType<Miniflare["getD1Database"]>>;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  runtime = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('Test database'); } }",
    d1Databases: ["DB"],
    compatibilityDate: "2026-07-01",
  });
  d1 = await runtime.getD1Database("DB");
  const migration = await readFile(
    new URL("../../../packages/db/src/migrations/0000_username_auth.sql", import.meta.url),
    "utf8",
  );

  await d1.batch(migration.split("--> statement-breakpoint").map((sql) => d1.prepare(sql)));
}, 30_000);

afterAll(async () => {
  await runtime?.dispose();
});
beforeEach(async () => {
  await d1.batch(
    ["session", "account", "verification", "user", "rate_limit"].map((table) =>
      d1.prepare(`DELETE FROM "${table}"`),
    ),
  );
  app = createApp(
    createAuth(config, createDb({ DB: d1 })),
    config.CORS_ORIGIN,
    createDb({ DB: d1 }),
  );
});

function request(
  path: string,
  body?: Record<string, unknown>,
  cookie = "",
  origin = config.CORS_ORIGIN,
) {
  return app.request(`${config.BETTER_AUTH_URL}${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      Cookie: cookie,
      "cf-connecting-ip": "192.0.2.1",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

function cookies(response: Response) {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

async function register(username = "alice", email = `${username}@example.com`) {
  const response = await request("/api/auth/sign-up/email", {
    username,
    name: username,
    email,
    password,
  });

  expect(response.status, await response.clone().text()).toBe(200);

  return response;
}

describe("username accounts and sessions", () => {
  it("registers, hashes passwords, persists sessions across app instances, and isolates users", async () => {
    const alice = await register("Alice");
    const bob = await register("bob");
    const aliceCookie = cookies(alice);
    const aliceBody = accountResponse.parse(await alice.json());
    const bobBody = accountResponse.parse(await bob.json());

    expect(aliceBody.user.username).toBe("alice");
    expect(alice.headers.get("set-cookie")).toContain("HttpOnly");
    expect(alice.headers.get("set-cookie")).toContain("SameSite=Lax");
    const stored = await d1
      .prepare("SELECT password FROM account WHERE user_id = ?")
      .bind(aliceBody.user.id)
      .first<{ password: string }>();

    expect(stored?.password).toBeTruthy();
    expect(stored?.password).not.toBe(password);

    app = createApp(
      createAuth(config, createDb({ DB: d1 })),
      config.CORS_ORIGIN,
      createDb({ DB: d1 }),
    );
    const me = await request(`/api/me?userId=${bobBody.user.id}`, undefined, aliceCookie);

    expect(me.status).toBe(200);
    expect(me.headers.get("cache-control")).toBe("no-store");
    expect(await me.json()).toEqual({
      user: { id: aliceBody.user.id, username: "alice" },
    });
    const bobMe = await request("/api/me", undefined, cookies(bob));

    expect(await bobMe.json()).toEqual({
      user: { id: bobBody.user.id, username: "bob" },
    });
    expect((await request("/api/me")).status).toBe(401);
  });

  it("signs in case-insensitively with a username, rejects email login and bad credentials", async () => {
    await register();
    const success = await request("/api/auth/sign-in/username", {
      username: "ALICE",
      password,
    });

    expect(success.status).toBe(200);
    expect((await request("/api/me", undefined, cookies(success))).status).toBe(200);
    expect(
      (
        await request("/api/auth/sign-in/email", {
          email: "alice@example.com",
          password,
        })
      ).status,
    ).toBe(404);
    const wrongPassword = await request("/api/auth/sign-in/username", {
      username: "alice",
      password: "wrong-password",
    });
    const wrongUser = await request("/api/auth/sign-in/username", {
      username: "missing",
      password,
    });

    expect(wrongPassword.status).toBe(401);
    expect(wrongUser.status).toBe(401);
    expect(await wrongPassword.json()).toEqual(await wrongUser.json());
  });

  it("requires a valid username and password even without the web form", async () => {
    for (const username of [undefined, "", "ab", "invalid name", "a".repeat(31)]) {
      const response = await request("/api/auth/sign-up/email", {
        username,
        name: "Invalid",
        email: "test@example.com",
        password,
      });

      expect(response.status).toBe(400);
    }

    expect(await d1.prepare("SELECT COUNT(*) AS count FROM user").first("count")).toBe(0);
  });

  it("rejects duplicate usernames regardless of case and duplicate emails", async () => {
    await register();
    const duplicate = await request("/api/auth/sign-up/email", {
      username: "ALICE",
      name: "Other",
      email: "other@example.com",
      password,
    });

    expect(duplicate.status).toBe(400);
    const duplicateEmail = await request("/api/auth/sign-up/email", {
      username: "other",
      name: "Other",
      email: "alice@example.com",
      password,
    });

    expect(duplicateEmail.ok).toBe(false);
    expect(await d1.prepare("SELECT COUNT(*) AS count FROM user").first("count")).toBe(1);
  });

  it("rejects short passwords", async () => {
    const response = await request("/api/auth/sign-up/email", {
      username: "alice",
      name: "Alice",
      email: "alice@example.com",
      password: "short",
    });

    expect(response.status).toBe(400);
    expect(await d1.prepare("SELECT COUNT(*) AS count FROM user").first("count")).toBe(0);
  });

  it("revokes the server session on logout, leaving another account signed in", async () => {
    const alice = cookies(await register());
    const bob = cookies(await register("bob"));

    expect((await request("/api/auth/sign-out", {}, alice)).status).toBe(200);
    expect((await request("/api/me", undefined, alice)).status).toBe(401);
    expect((await request("/api/me", undefined, bob)).status).toBe(200);
  });

  it("rejects expired and tampered session cookies", async () => {
    const cookie = cookies(await register());

    expect((await request("/api/me", undefined, cookie + "tampered")).status).toBe(401);
    await d1.prepare("UPDATE session SET expires_at = 0").run();
    expect((await request("/api/me", undefined, cookie)).status).toBe(401);
  });

  it("rejects writes from an untrusted origin", async () => {
    const cookie = cookies(await register());

    expect(
      (await request("/api/auth/sign-out", {}, cookie, "https://untrusted.example")).status,
    ).toBe(403);
    expect((await request("/api/me", undefined, cookie)).status).toBe(200);
  });

  it("uses secure HTTP-only cookies for an HTTPS deployment", async () => {
    const production = {
      ...config,
      BETTER_AUTH_URL: "https://api.example.com",
      CORS_ORIGIN: "https://app.example.com",
    };

    app = createApp(
      createAuth(production, createDb({ DB: d1 })),
      production.CORS_ORIGIN,
      createDb({ DB: d1 }),
    );
    const response = await app.request(`${production.BETTER_AUTH_URL}/api/auth/sign-up/email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: production.CORS_ORIGIN,
        "cf-connecting-ip": "192.0.2.1",
      },
      body: JSON.stringify({
        username: "alice",
        name: "Alice",
        email: "alice@example.com",
        password,
      }),
    });

    expect(response.status).toBe(200);
    const cookie = response.headers.get("set-cookie");

    expect(cookie).toContain("Secure");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=None");
    expect(response.headers.get("access-control-allow-origin")).toBe(production.CORS_ORIGIN);
  });

  it("keeps login rate limits across app instances", async () => {
    for (let i = 0; i < 5; i++) {
      const response = await request("/api/auth/sign-in/username", {
        username: "unknown",
        password,
      });

      expect(response.status).toBe(401);
    }

    app = createApp(
      createAuth(config, createDb({ DB: d1 })),
      config.CORS_ORIGIN,
      createDb({ DB: d1 }),
    );
    const blocked = await request("/api/auth/sign-in/username", {
      username: "unknown",
      password,
    });

    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("x-retry-after"))).toBeGreaterThan(0);
  });
});

it("verifies email through a signed link and rejects a tampered link", async () => {
  const sent: string[] = [];
  const db = createDb({ DB: d1 });

  app = createApp(
    createAuth(config, db, [], {
      send: async (_to, _subject, text) => {
        sent.push(text);
      },
    }),
    config.CORS_ORIGIN,
    db,
  );
  const cookie = cookies(await register());
  const response = await request(
    "/api/auth/send-verification-email",
    { email: "alice@example.com", callbackURL: `${config.CORS_ORIGIN}/settings` },
    cookie,
  );

  expect(response.status).toBe(200);
  const link = sent[0]!.match(/https?:\/\/\S+/)![0];
  const invalid = new URL(link);

  invalid.searchParams.set("token", "invalid");
  await app.request(invalid.href);
  expect(
    await d1
      .prepare("SELECT email_verified FROM user WHERE username = 'alice'")
      .first("email_verified"),
  ).toBe(0);
  const verified = await app.request(link);

  expect(verified.headers.get("Location")).toBe(`${config.CORS_ORIGIN}/settings`);
  expect(
    await d1
      .prepare("SELECT email_verified FROM user WHERE username = 'alice'")
      .first("email_verified"),
  ).toBe(1);
});
it("resets a password with a one-use emailed token and revokes existing sessions", async () => {
  const sent: string[] = [];
  const db = createDb({ DB: d1 });

  app = createApp(
    createAuth(config, db, [], {
      send: async (_to, _subject, text) => {
        sent.push(text);
      },
    }),
    config.CORS_ORIGIN,
    db,
  );
  const cookie = cookies(await register());

  expect(
    (
      await request("/api/auth/request-password-reset", {
        email: "alice@example.com",
        redirectTo: `${config.CORS_ORIGIN}/reset-password`,
      })
    ).status,
  ).toBe(200);
  const link = sent[0]!.match(/https?:\/\/\S+/)![0];
  const redirected = await app.request(link);
  const token = new URL(redirected.headers.get("Location")!).searchParams.get("token");
  const body = { token, newPassword: "updated-password-456" };

  expect((await request("/api/auth/reset-password", body)).status).toBe(200);
  expect((await request("/api/me", undefined, cookie)).status).toBe(401);
  expect((await request("/api/auth/reset-password", body)).ok).toBe(false);
  expect(
    (await request("/api/auth/sign-in/username", { username: "alice", password: body.newPassword }))
      .status,
  ).toBe(200);
});

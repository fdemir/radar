import type { Database } from "@radar/db";
import * as schema from "@radar/db/schema/auth";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { username } from "better-auth/plugins";

export type AuthConfig = {
  BETTER_AUTH_URL: string;
  BETTER_AUTH_SECRET: string;
  CORS_ORIGIN: string;
};

export function createAuth(
  env: AuthConfig,
  database: Database,
  desktopOrigins: readonly string[] = [],
) {
  const secure = new URL(env.BETTER_AUTH_URL).protocol === "https:";

  return betterAuth({
    database: drizzleAdapter(database, {
      provider: "sqlite",
      schema,
    }),
    trustedOrigins: [env.CORS_ORIGIN, ...desktopOrigins],
    emailAndPassword: { enabled: true },
    disabledPaths: ["/sign-in/email"],
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/sign-up/email" && typeof ctx.body?.username !== "string") {
          throw new APIError("BAD_REQUEST", {
            message: "Username is required",
          });
        }
      }),
    },
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    advanced: {
      disableOriginCheck: false,
      disableCSRFCheck: false,
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
      defaultCookieAttributes: {
        sameSite: secure ? "none" : "lax",
        secure,
        httpOnly: true,
      },
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      customRules: {
        "/sign-in/username": { window: 60, max: 5 },
        "/sign-up/email": { window: 60, max: 5 },
      },
    },
    plugins: [username({ displayUsername: false })],
  });
}

export type Session = ReturnType<typeof createAuth>["$Infer"]["Session"];

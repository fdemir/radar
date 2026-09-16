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
  email?: { send: (to: string, subject: string, text: string, key: string) => Promise<void> },
) {
  const secure = new URL(env.BETTER_AUTH_URL).protocol === "https:";

  return betterAuth({
    database: drizzleAdapter(database, {
      provider: "sqlite",
      schema,
    }),
    trustedOrigins: [env.CORS_ORIGIN, ...desktopOrigins],
    emailAndPassword: {
      enabled: true,
      revokeSessionsOnPasswordReset: true,
      ...(email
        ? {
            sendResetPassword: async ({
              user,
              url,
              token,
            }: {
              user: { email: string };
              url: string;
              token: string;
            }) => {
              await email.send(
                user.email,
                "Reset your Radar password",
                `Reset your password:\n${url}\n\nIf you did not request this, ignore this email.`,
                await emailKey("reset", token),
              );
            },
          }
        : {}),
    },
    ...(email
      ? {
          emailVerification: {
            sendOnSignUp: false,
            autoSignInAfterVerification: false,
            sendVerificationEmail: async ({
              user,
              url,
              token,
            }: {
              user: { email: string };
              url: string;
              token: string;
            }) => {
              await email.send(
                user.email,
                "Verify your Radar email",
                `Verify your email to receive new findings:\n${url}`,
                await emailKey("verify", token),
              );
            },
          },
        }
      : {}),
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
        "/send-verification-email": { window: 60, max: 2 },
        "/request-password-reset": { window: 60, max: 2 },
      },
    },
    plugins: [username({ displayUsername: false })],
  });
}

async function emailKey(kind: string, token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return `${kind}-${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export type Session = ReturnType<typeof createAuth>["$Infer"]["Session"];

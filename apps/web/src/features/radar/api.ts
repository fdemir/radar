import { ENV } from "@/env.public";
import z from "zod";

export async function api(path: string, method = "GET", body?: unknown) {
  const response = await fetch(`${ENV.VITE_SERVER_URL}/api${path}`, {
    method,
    credentials: "include",
    cache: "no-store",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (response.status === 401) {
    window.location.assign("/login");
    throw new Error("Sign in to continue.");
  }
  if (!response.ok) {
    const parsed = z
      .object({ error: z.string() })
      .safeParse(await response.json().catch(() => null));
    throw new Error(parsed.success ? parsed.data.error : "Unable to save changes. Try again.");
  }
  return response.status === 204 ? null : response.json();
}

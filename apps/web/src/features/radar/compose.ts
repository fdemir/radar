import type { TaskInput } from "@radar/core";
import { composeEventSchema, readEventData } from "@radar/core/stream";
import z from "zod";
import { ENV } from "@/env.public";

export async function compose(
  task: TaskInput,
  message: string,
  onReply: (text: string) => void,
  signal: AbortSignal,
) {
  const response = await fetch(`${ENV.VITE_SERVER_URL}/api/tasks/compose`, {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({ task, message }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(75_000)]),
  });

  if (!response.ok) {
    const error = z
      .object({ error: z.string() })
      .safeParse(await response.json().catch(() => null));

    throw new Error(error.success ? error.data.error : "Unable to send your message. Try again.");
  }

  if (!response.body || !response.headers.get("Content-Type")?.includes("text/event-stream"))
    throw new Error("Unable to read the reply. Try again.");

  for await (const data of readEventData(response.body)) {
    signal.throwIfAborted();

    const parsed = composeEventSchema.safeParse(JSON.parse(data));

    if (!parsed.success) throw new Error("Unable to read the reply. Try again.");

    const event = parsed.data;

    if (event.type === "error") throw new Error(event.message);

    if (event.type === "reply") onReply(event.text);

    if (event.type === "complete") return event.task;
  }

  throw new Error("The reply was interrupted. Try again.");
}

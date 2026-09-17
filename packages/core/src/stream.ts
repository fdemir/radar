import { createParser } from "eventsource-parser";
import z from "zod";
import { taskInputSchema } from "./index";

export const composeEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("reply"), text: z.string().max(4000) }),
  z.object({ type: z.literal("complete"), task: taskInputSchema }),
  z.object({ type: z.literal("error"), message: z.string() }),
]);

export type ComposeEvent = z.infer<typeof composeEventSchema>;

type ByteStream = {
  getReader(): Pick<ReadableStreamDefaultReader<Uint8Array>, "read" | "cancel" | "releaseLock">;
};

export async function* readEventData(body: ByteStream) {
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
  const reader = body.getReader();
  const events: string[] = [];
  const parser = createParser({
    maxBufferSize: 400_000,
    onEvent: (event) => events.push(event.data),
    onError: (error) => {
      throw error;
    },
  });

  try {
    while (true) {
      const { done, value } = await reader.read();

      parser.feed(
        done ? decoder.decode() : decoder.decode(new Uint8Array(value), { stream: true }),
      );

      yield* events;
      events.length = 0;

      if (done) return;
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

import { parsePartialJson } from "@langchain/core/output_parsers";
import { taskInputSchema, type TaskInput } from "@radar/core";
import { readEventData } from "@radar/core/stream";
import z from "zod";

const briefSchema = z.object({
  reply: z.string().trim().min(1).max(2000),
  title: taskInputSchema.shape.title.min(1),
  brief: taskInputSchema.shape.brief.min(1),
  category: taskInputSchema.shape.category,
  frequency: taskInputSchema.shape.frequency,
  time: taskInputSchema.shape.time,
  language: taskInputSchema.shape.language,
});
const partialReplySchema = z.object({ reply: z.string().max(2000) });
const chunkSchema = z.object({
  choices: z.array(
    z.object({
      delta: z.object({ content: z.string().nullable().optional() }),
      finish_reason: z.string().nullable().optional(),
    }),
  ),
});

export type ComposeOptions = {
  signal?: AbortSignal;
  onText?: (text: string) => Promise<void>;
};

export async function composeTask(
  config: { OPENAI_API_KEY: string; OPENAI_BASE_URL: string; OPENAI_MODEL: string },
  task: TaskInput,
  message: string,
  options: ComposeOptions = {},
) {
  const signal = AbortSignal.any([
    AbortSignal.timeout(65_000),
    ...(options.signal ? [options.signal] : []),
  ]);
  const { email: _legacyEmail, ...taskDetails } = task;
  const response = await fetch(`${config.OPENAI_BASE_URL.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    signal,
    redirect: "manual",
    body: JSON.stringify({
      model: config.OPENAI_MODEL,
      stream: Boolean(options.onText),
      messages: [
        {
          role: "system",
          content: `You help create a recurring web research task. Update the brief from the existing details, conversation and newest message. Keep all existing constraints unless the user changes them. Do not invent a location, budget or event. Ask one short question if essential information is missing. Otherwise briefly confirm the task is ready for review. The brief describes what counts as a match; do not claim you searched or activated a task. Reply in the user's language, with short paragraphs or a short list. Preserve the selected result language and time unless asked to change them. Notification channels follow the user’s account preferences in Settings. Do not ask the user to choose notification channels during task setup; direct notification preference requests to Settings. Use simple English for English replies. Do not use em dashes. Return only a JSON object matching this schema: ${JSON.stringify(z.toJSONSchema(briefSchema))}. Write the reply property FIRST so the user can read it while the other fields are generated.`,
        },
        {
          role: "user",
          content: `Return JSON for this data:\n${JSON.stringify({ task: taskDetails, message })}`,
        },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 4000,
    }),
  });

  if (!response.ok) throw new Error("The assistant is unavailable. Try again.");

  let content = "";

  if (response.headers.get("Content-Type")?.includes("text/event-stream")) {
    if (!response.body) throw new Error("The assistant returned an empty response.");

    let finished = false;
    let previousText = "";

    for await (const data of readEventData(response.body)) {
      signal.throwIfAborted();

      if (data === "[DONE]") break;

      const chunk = chunkSchema.parse(JSON.parse(data)).choices[0];

      if (!chunk) continue;

      if (chunk.finish_reason) finished = chunk.finish_reason === "stop";

      content += chunk.delta.content ?? "";

      if (content.length > 40_000) throw new Error("The assistant response was too long.");

      const partial = partialReplySchema.safeParse(parsePartialJson(content));

      if (partial.success && partial.data.reply !== previousText) {
        previousText = partial.data.reply;
        await options.onText?.(previousText);
      }
    }

    if (!finished) throw new Error("The reply was interrupted. Try again.");
  } else {
    const parsed = z
      .object({ choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1) })
      .parse(await response.json());

    content = parsed.choices[0]!.message.content;
  }

  signal.throwIfAborted();

  const { reply, ...details } = briefSchema.parse(JSON.parse(content));

  return taskInputSchema.parse({
    ...task,
    ...details,
    messages: [
      ...task.messages,
      { role: "user", text: message },
      { role: "assistant", text: reply },
    ],
  });
}

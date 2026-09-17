import { APICallError, generateText, Output, streamText } from "ai";
import { createModel, type ModelConfig } from "./model-client";
import { composePrompt } from "./compose-prompt";
import { taskInputSchema, type TaskInput } from "@radar/core";
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

export type ComposeOptions = {
  signal?: AbortSignal;
  onText?: (text: string) => Promise<void>;
};

export class ComposeUnavailableError extends Error {
  constructor(public readonly providerStatus: number) {
    super(
      "The AI service is temporarily unavailable. Please try again later or edit the brief directly.",
    );
    this.name = "ComposeUnavailableError";
  }
}

export async function composeTask(
  config: ModelConfig,
  task: TaskInput,
  message: string,
  options: ComposeOptions = {},
) {
  const signal = AbortSignal.any([
    AbortSignal.timeout(65_000),
    ...(options.signal ? [options.signal] : []),
  ]);
  const { email: _legacyEmail, ...taskDetails } = task;
  const model = createModel(config);
  const settings = {
    model,
    maxRetries: 0,
    abortSignal: signal,
    maxOutputTokens: 4000,
    output: Output.object({ schema: briefSchema }),
    instructions: composePrompt(JSON.stringify(z.toJSONSchema(briefSchema))),
    messages: [
      {
        role: "user" as const,
        content: `Return JSON for this data:\n${JSON.stringify({ task: taskDetails, message })}`,
      },
    ],
  };
  let details: z.infer<typeof briefSchema>;

  try {
    if (options.onText) {
      let failure: unknown;
      let previousText = "";
      const result = streamText({
        ...settings,
        onError: ({ error }) => {
          failure = error;
        },
      });

      for await (const partial of result.partialOutputStream) {
        signal.throwIfAborted();

        if (
          typeof partial.reply === "string" &&
          partial.reply.length <= 2000 &&
          partial.reply !== previousText
        ) {
          previousText = partial.reply;
          await options.onText(previousText);
        }
      }

      if (failure) throw failure;

      if ((await result.finishReason) !== "stop")
        throw new Error("The reply was interrupted. Try again.");

      details = await result.output;
    } else {
      details = (await generateText(settings)).output;
    }
  } catch (error) {
    if (APICallError.isInstance(error) && error.statusCode !== undefined)
      throw new ComposeUnavailableError(error.statusCode);

    throw error;
  }

  signal.throwIfAborted();

  const { reply, ...updatedDetails } = details;

  return taskInputSchema.parse({
    ...task,
    ...updatedDetails,
    messages: [
      ...task.messages,
      { role: "user", text: message },
      { role: "assistant", text: reply },
    ],
  });
}

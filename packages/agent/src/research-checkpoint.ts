import z from "zod";
import { researchResultSchema } from "@radar/core/research";
import {
  parseToolCall,
  stateSchema,
  type ResearchCheckpoint,
  type ResearchToolCall,
} from "./research-state";

const legacyCallSchema = z.object({
  id: z.string(),
  function: z.object({ name: z.string(), arguments: z.string() }),
});
const legacyMessageSchema = z.object({
  role: z.enum(["user", "assistant", "tool"]),
  content: z.string().nullable().default(null),
  tool_calls: z.array(legacyCallSchema).default([]),
  tool_call_id: z.string().optional(),
});

function migrateCall(call: z.infer<typeof legacyCallSchema>): ResearchToolCall {
  let input: unknown = call.function.arguments;

  try {
    input = JSON.parse(call.function.arguments);
  } catch {
    /* Kept as an invalid call for model feedback. */
  }

  return parseToolCall(call.id, call.function.name, input);
}

// Both former formats remain readable while queued work crosses a deployment.
export function restoreCheckpoint(value: unknown): ResearchCheckpoint | null {
  if (!value) return null;

  const version = z.object({ version: z.number().optional() }).parse(value).version;

  if (version === 3) return z.object({ version: z.literal(3), state: stateSchema }).parse(value);

  if (version !== undefined && version !== 2)
    throw new Error("Unsupported research checkpoint version.");

  const legacy = z
    .object({
      next: z.enum(["model", "tools", "plan", "search", "read", "evaluate", "expand", "finish"]),
      state: stateSchema.omit({ messages: true, execution: true }).extend({
        messages: z.array(legacyMessageSchema).default([]),
        pending: z.array(legacyCallSchema).default([]),
        result: researchResultSchema.nullable().default(null),
        insufficient: z.boolean().default(false),
      }),
    })
    .parse(value);
  const state = stateSchema.parse({ ...legacy.state, messages: [] });

  state.limited ||= legacy.state.insufficient;

  if (version === 2) {
    const calls = legacy.state.messages.flatMap((message) => message.tool_calls);

    state.messages = legacy.state.messages.map((message) => {
      if (message.role === "assistant")
        return {
          role: "assistant",
          content: message.content ?? "",
          calls: message.tool_calls.map(migrateCall),
        };

      if (message.role === "tool") {
        const call = calls.find((call) => call.id === message.tool_call_id);

        if (!call) throw new Error("Checkpoint tool result has no matching call.");

        return {
          role: "tool",
          callId: call.id,
          toolName: call.function.name,
          content: message.content ?? "",
        };
      }

      return { role: "user", content: message.content ?? "" };
    });

    if (legacy.state.pending.length)
      state.execution = { phase: "tools", pending: legacy.state.pending.map(migrateCall) };
    else if (legacy.state.result)
      state.execution = { phase: "finish", result: legacy.state.result };
  } else {
    state.messages = [
      {
        role: "user",
        content: JSON.stringify({
          resume:
            "Continue this research using the completed searches and pages below. Do not repeat them.",
          searches: state.searched,
          searchResults: state.candidates,
          pages: state.sources,
        }),
      },
    ];

    if (legacy.next === "finish" && legacy.state.result)
      state.execution = { phase: "finish", result: legacy.state.result };
  }

  return { version: 3, state };
}

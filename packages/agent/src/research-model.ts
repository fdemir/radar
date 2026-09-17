import { APICallError, generateText, Output, tool, type ModelMessage } from "ai";
import z from "zod";
import type { TaskInput } from "@radar/core";
import { ResearchDeferred, type ResearchRequestHooks } from "@radar/core/research";
import { createModel, type ModelConfig } from "./model-client";
import { ProviderError, runProviderOperation } from "./provider-operation";
import { searchQuerySchema } from "./retrieval";
import { decisionSchema, type ModelDecision } from "./research-decision";
import { researchPrompt } from "./research-prompt";
import {
  parseToolCall,
  readInputSchema,
  toolCallSchema,
  researchLimits,
  ResearchError,
  ResearchCancelled,
  type PreviousFinding,
  type ResearchState,
} from "./research-state";

const researchTools = {
  searchWeb: tool({
    description:
      "Find relevant web pages. Returns URLs, titles and search snippets for choosing what to read. Search snippets are leads, not verified findings.",
    inputSchema: searchQuerySchema,
  }),
  scrapeWebsite: tool({
    description:
      "Read a public web URL to verify a lead. Use search results, page links, or a known primary-source address. A proposed URL is not evidence until successfully read. Returns page content and links, or a reading error.",
    inputSchema: readInputSchema,
  }),
};

type ModelInput = {
  task: TaskInput;
  previous: PreviousFinding[];
  state: ResearchState;
  finalTurn: boolean;
  today: string;
  signal: AbortSignal;
  requests?: ResearchRequestHooks & { deadline?: number };
};

function modelMessages(messages: ResearchState["messages"]): ModelMessage[] {
  return messages.map((message): ModelMessage => {
    if (message.role === "user") return message;

    if (message.role === "tool")
      return {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: message.callId,
            toolName: message.toolName,
            output: { type: "text", value: message.content },
          },
        ],
      };

    return {
      role: "assistant",
      content: [
        ...(message.content ? [{ type: "text" as const, text: message.content }] : []),
        ...message.calls.map((call) => ({
          type: "tool-call" as const,
          toolCallId: call.id,
          toolName: call.name === "invalid" ? call.originalName : call.name,
          input: call.input,
        })),
      ],
    };
  });
}

function providerFailure(cause: unknown): ProviderError {
  if (APICallError.isInstance(cause)) {
    const status = cause.statusCode ?? null;

    return new ProviderError(
      status === 429
        ? "rate_limit"
        : status !== null && status >= 400
          ? "http"
          : status === null
            ? "network"
            : "invalid_response",
      status,
      { cause: cause.cause ?? cause, retryAfter: cause.responseHeaders?.["retry-after"] },
    );
  }

  if (cause instanceof Error && cause.name === "TimeoutError")
    return new ProviderError("timeout", null, { cause });

  return new ProviderError("invalid_response", 200, { cause });
}

export function createResearchModel(config: ModelConfig, request: typeof fetch = fetch) {
  const model = createModel(config, request);

  return async ({
    task,
    previous,
    state,
    finalTurn,
    today,
    signal,
    requests,
  }: ModelInput): Promise<ModelDecision> => {
    try {
      const reply = await runProviderOperation({
        ...requests,
        service: "model",
        operation: `model:${state.turns}`,
        target: `${config.OPENAI_BASE_URL.replace(/\/$/, "")}/chat/completions`,
        signal,
        timeoutMs: 60_000,
        execute: async (abortSignal) => {
          try {
            const value = await generateText({
              model,
              maxRetries: 0,
              abortSignal,
              maxOutputTokens: 4000,
              output: Output.json(),
              instructions: researchPrompt(
                today,
                task.language,
                JSON.stringify(z.toJSONSchema(decisionSchema)),
              ),
              messages: [
                {
                  role: "user",
                  content: `Return JSON for this data:\n${JSON.stringify({
                    brief: task.brief,
                    frequency: task.frequency,
                    previous: previous
                      .slice(0, 100)
                      .map((item) => ({ ...item, summary: item.summary.slice(0, 200) })),
                  })}`,
                },
                ...modelMessages(state.messages),
                {
                  role: "user",
                  content: finalTurn
                    ? "This is the final turn. Do not call tools. Return the verified findings collected so far as JSON, and mark incomplete evidence honestly."
                    : `Remaining: ${researchLimits.turns - state.turns} assistant turns, ${researchLimits.searches - state.searched.length} searches, ${researchLimits.pageReads - state.attempted.length} page reads. Continue the workflow or return the final JSON.`,
                },
              ],
              tools: researchTools,
              toolChoice: finalTurn ? "none" : "auto",
            });

            return { value, status: 200 };
          } catch (cause) {
            throw providerFailure(cause);
          }
        },
      });

      if (reply.toolCalls.length) {
        const calls = z
          .array(toolCallSchema)
          .max(researchLimits.toolCalls)
          .parse(
            reply.toolCalls.map((call) =>
              parseToolCall(call.toolCallId, call.toolName, call.input),
            ),
          );

        return { kind: "tools", text: reply.text, calls };
      }

      try {
        return {
          kind: "final",
          text: reply.text,
          result: decisionSchema.parse(JSON.parse(reply.text)),
        };
      } catch {
        return { kind: "invalid", text: reply.text };
      }
    } catch (cause) {
      signal.throwIfAborted();

      if (cause instanceof ResearchDeferred || cause instanceof ResearchCancelled) throw cause;

      throw new ResearchError(
        cause instanceof ProviderError && cause.kind === "invalid_response"
          ? "The assistant returned an incomplete response. Try again."
          : "Research assistant is unavailable. Try again later.",
        {
          cause:
            cause instanceof ProviderError
              ? cause.kind === "http"
                ? new Error(`Model provider returned HTTP ${cause.status}.`)
                : (cause.cause ?? cause)
              : cause,
        },
      );
    }
  };
}

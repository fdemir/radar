import { finalizeDecision, type ModelDecision } from "./decision";
import { ResearchError, type ResearchState, type ToolState } from "./state";
import type { ToolOutcome } from "./tools";

export function applyModelDecision(
  state: ResearchState,
  decision: ModelDecision,
  finalTurn: boolean,
  language: string,
): ResearchState {
  const updated: ResearchState = {
    ...state,
    turns: state.turns + 1,
    messages: [
      ...state.messages,
      {
        role: "assistant",
        content: decision.text,
        calls: decision.kind === "tools" ? decision.calls : [],
      },
    ],
  };

  if (decision.kind === "tools") {
    if (finalTurn)
      return {
        ...updated,
        limited: true,
        execution: {
          phase: "finish",
          result: {
            summary: language === "Türkçe" ? "Yeni eşleşme yok." : "No new matches.",
            findings: [],
          },
        },
      };

    if (!decision.calls.length)
      throw new ResearchError("The assistant returned an empty tool decision.");

    return { ...updated, execution: { phase: "tools", pending: decision.calls } };
  }

  if (decision.kind === "invalid") {
    if (finalTurn)
      throw new ResearchError("The assistant returned an incomplete response. Try again.");

    return {
      ...updated,
      execution: { phase: "model" },
      messages: [
        ...updated.messages,
        {
          role: "user",
          content:
            "Your response was not a valid result. Continue with the available tools, or return a JSON result matching the required schema.",
        },
      ],
    };
  }

  const { result, limited } = finalizeDecision(decision.result, state);

  return { ...updated, limited, execution: { phase: "finish", result } };
}

export function applyToolResult(state: ToolState, outcome: ToolOutcome): ResearchState {
  const [call, ...pending] = state.execution.pending;

  if (!call) throw new Error("No pending research tool.");

  return {
    ...state,
    ...outcome.changes,
    execution: pending.length ? { phase: "tools", pending } : { phase: "model" },
    messages: [
      ...state.messages,
      {
        role: "tool",
        callId: call.id,
        toolName: call.name === "invalid" ? call.originalName : call.name,
        content: outcome.content,
      },
    ],
  };
}

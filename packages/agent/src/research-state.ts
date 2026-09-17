import z from "zod";
import { researchResultSchema, type Candidate, type ResearchService } from "@radar/core/research";
import { searchSourceSchema, sourceSchema } from "./retrieval";

export class ResearchError extends Error {}

export class ResearchCancelled extends Error {}

export const researchLimits = {
  turns: 7,
  searches: 5,
  pageReads: 10,
  followupSearches: 2,
  durationMs: 300_000,
  finalTurnAfterMs: 240_000,
} as const;

// Values are persisted and used by the run-history UI.
export const researchStages = {
  searching: 1,
  reading: 2,
  evaluating: 3,
  finishing: 4,
  expanding: 6,
} as const;

export type PreviousFinding = Pick<Candidate, "eventKey" | "version" | "title" | "summary">;

export type ResearchStage = (typeof researchStages)[keyof typeof researchStages];

// Returning false means the run was cancelled or lost its lease and must stop.
export type ResearchProgress = (stage: ResearchStage, sources?: string[]) => Promise<boolean>;

export const toolCallSchema = z.object({
  id: z.string(),
  type: z.literal("function"),
  function: z.object({ name: z.string(), arguments: z.string() }),
});

export const messageSchema = z.object({
  role: z.enum(["user", "assistant", "tool"]),
  content: z.string().nullable().default(null),
  tool_calls: z.array(toolCallSchema).max(10).optional(),
  tool_call_id: z.string().optional(),
});

export const stateSchema = z.object({
  messages: z.array(messageSchema).default([]),
  pending: z.array(toolCallSchema).default([]),
  candidates: z.array(searchSourceSchema).default([]),
  sources: z.array(sourceSchema).default([]),
  searched: z.array(z.string()).default([]),
  attempted: z.array(z.string()).default([]),
  turns: z.number().default(0),
  followups: z.number().default(0),
  searchFailures: z.number().default(0),
  limited: z.boolean().default(false),
  result: researchResultSchema.nullable().default(null),
});

export const nodeNames = ["model", "tools", "finish"] as const;

const checkpointSchema = z.object({
  version: z.literal(2),
  next: z.enum(nodeNames),
  state: stateSchema,
});

export type ResearchState = z.output<typeof stateSchema>;

export type ResearchCheckpoint = z.output<typeof checkpointSchema>;

export type ResearchOptions = {
  checkpoint?: unknown;
  saveCheckpoint?: (checkpoint: ResearchCheckpoint) => Promise<boolean>;
  reserve?: (service: ResearchService, amount: number) => Promise<void>;
  backoff?: (service: ResearchService, retryAt: number) => Promise<void>;
};

// Preserve completed provider work when a queued run crosses a deployment.
export function restoreCheckpoint(value: unknown): ResearchCheckpoint | null {
  if (!value) return null;

  const current = checkpointSchema.safeParse(value);

  if (current.success) return current.data;

  const legacy = z
    .object({
      next: z.enum(["plan", "search", "read", "evaluate", "expand", "finish"]),
      state: stateSchema.extend({ insufficient: z.boolean().default(false) }),
    })
    .parse(value);
  const state = stateSchema.parse(legacy.state);

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
  state.limited ||= legacy.state.insufficient;

  if (legacy.next !== "finish") state.result = null;

  return { version: 2, next: legacy.next === "finish" && state.result ? "finish" : "model", state };
}

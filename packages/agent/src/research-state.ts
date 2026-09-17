import z from "zod";
import {
  researchResultSchema,
  type Candidate,
  type ResearchRequestHooks,
} from "@radar/core/research";
import { searchQuerySchema, searchSourceSchema, sourceSchema } from "./retrieval";

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

export const readInputSchema = z.object({ url: z.string() });

export const toolCallSchema = z.discriminatedUnion("name", [
  z.object({ id: z.string(), name: z.literal("searchWeb"), input: searchQuerySchema }),
  z.object({ id: z.string(), name: z.literal("scrapeWebsite"), input: readInputSchema }),
  z.object({
    id: z.string(),
    name: z.literal("invalid"),
    originalName: z.string(),
    input: z.unknown(),
  }),
]);

export type ResearchToolCall = z.output<typeof toolCallSchema>;

export function parseToolCall(id: string, name: string, input: unknown): ResearchToolCall {
  const parsed = toolCallSchema.safeParse({ id, name, input });

  return parsed.success ? parsed.data : { id, name: "invalid", originalName: name, input };
}

export const messageSchema = z.discriminatedUnion("role", [
  z.object({ role: z.literal("user"), content: z.string() }),
  z.object({
    role: z.literal("assistant"),
    content: z.string(),
    calls: z.array(toolCallSchema).max(10),
  }),
  z.object({
    role: z.literal("tool"),
    callId: z.string(),
    toolName: z.string(),
    content: z.string(),
  }),
]);

export const stateSchema = z.object({
  messages: z.array(messageSchema).default([]),
  candidates: z.array(searchSourceSchema).default([]),
  sources: z.array(sourceSchema).default([]),
  searched: z.array(z.string()).default([]),
  attempted: z.array(z.string()).default([]),
  turns: z.number().int().nonnegative().default(0),
  followups: z.number().int().nonnegative().default(0),
  searchFailures: z.number().int().nonnegative().default(0),
  limited: z.boolean().default(false),
  execution: z
    .discriminatedUnion("phase", [
      z.object({ phase: z.literal("model") }),
      z.object({ phase: z.literal("tools"), pending: z.array(toolCallSchema).min(1).max(10) }),
      z.object({ phase: z.literal("finish"), result: researchResultSchema }),
    ])
    .default({ phase: "model" }),
});

export type ResearchState = z.output<typeof stateSchema>;

export type ToolState = ResearchState & {
  execution: Extract<ResearchState["execution"], { phase: "tools" }>;
};

export type ResearchCheckpoint = { version: 3; state: ResearchState };

export type ResearchOptions = ResearchRequestHooks & {
  checkpoint?: unknown;
  saveCheckpoint?: (checkpoint: ResearchCheckpoint) => Promise<boolean>;
};

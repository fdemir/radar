import { expect, it, vi } from "vitest";
import { taskInputSchema } from "@radar/core";
import { restoreCheckpoint } from "../../../packages/agent/src/research-checkpoint";
import { createResearch } from "../../../packages/agent/src/research";
import { decisionSchema, finalizeDecision } from "../../../packages/agent/src/research-decision";
import { stateSchema, type ResearchCheckpoint } from "../../../packages/agent/src/research-state";
import type { createResearchModel } from "../../../packages/agent/src/research-model";

const url = "https://hono.dev/releases";
const page = {
  url,
  title: "Hono release",
  content: "Hono 5.0 is the latest stable release.",
  links: [],
};
const decision = decisionSchema.parse({
  summary: "Hono 5.0 is available.",
  needsMoreEvidence: false,
  findings: [
    {
      title: "Hono **5.0** released",
      summary: "Includes **streaming support**.",
      reason: "Stable release",
      url,
      evidence: page.content,
      eventKey: "hono-release",
      version: "5.0",
    },
  ],
});
const task = taskInputSchema.parse({
  title: "Hono releases",
  brief: "Track stable Hono releases",
  category: "Technology",
  status: "active",
  frequency: "Daily",
  time: "09:00",
  language: "English",
  email: false,
  messages: [],
});

it("resumes a v2 pending read without repeating its completed search or model decision", async () => {
  const searchCall = {
    id: "search-1",
    type: "function",
    function: { name: "searchWeb", arguments: '{"query":"Hono releases"}' },
  };
  const readCall = {
    id: "read-1",
    type: "function",
    function: { name: "scrapeWebsite", arguments: JSON.stringify({ url }) },
  };
  const checkpoint = {
    version: 2,
    next: "tools",
    state: {
      searched: ["completed-search"],
      turns: 2,
      messages: [
        { role: "assistant", content: null, tool_calls: [searchCall] },
        { role: "tool", tool_call_id: "search-1", content: '{"results":[]}' },
        { role: "assistant", content: null, tool_calls: [readCall] },
      ],
      pending: [readCall],
    },
  };
  const search = vi.fn();
  const read = vi.fn(async () => page);
  const model = vi.fn<ReturnType<typeof createResearchModel>>(async () => ({
    kind: "final",
    text: JSON.stringify(decision),
    result: decision,
  }));
  const saved: ResearchCheckpoint[] = [];
  const research = createResearch({ model, sources: () => ({ search, read }) });

  const result = await research(task, [], async () => true, {
    checkpoint,
    saveCheckpoint: async (checkpoint) => {
      saved.push(checkpoint);

      return true;
    },
  });

  expect(search).not.toHaveBeenCalled();
  expect(read).toHaveBeenCalledExactlyOnceWith(url, url, "tool:read-1");
  expect(model).toHaveBeenCalledOnce();
  expect(result.findings).toHaveLength(1);
  expect(saved[0]?.version).toBe(3);
  expect(saved[0]?.state.execution).toEqual({ phase: "model" });
  expect(saved[0]?.state.messages.at(-1)).toMatchObject({
    role: "tool",
    callId: "read-1",
    toolName: "scrapeWebsite",
  });
  expect(restoreCheckpoint(JSON.parse(JSON.stringify(saved[0])))).toEqual(saved[0]);
});

it("rejects an invalid current checkpoint instead of silently restarting the research", () => {
  expect(() =>
    restoreCheckpoint({ version: 3, state: { execution: { phase: "tools", pending: [] } } }),
  ).toThrow();
  expect(() => restoreCheckpoint({ version: 4, state: {} })).toThrow(
    "Unsupported research checkpoint version",
  );
});

it("finalizes source-backed findings independently of model and workflow execution", () => {
  const state = stateSchema.parse({ searched: ["completed-search"], sources: [page] });
  const result = finalizeDecision(decision, state);

  expect(result.limited).toBe(false);
  expect(result.result.findings[0]).toMatchObject({
    title: "Hono 5.0 released",
    summary: "Includes **streaming support**.",
    evidence: page.content,
  });

  const unverified = finalizeDecision(
    {
      ...decision,
      findings: decision.findings.map((finding) => ({
        ...finding,
        evidence: "This quote does not appear on the page.",
      })),
    },
    state,
  );

  expect(unverified.result.findings).toHaveLength(1);
  expect(unverified.result.findings[0]?.evidence).toBe("");
  expect(unverified.limited).toBe(true);
  expect(() => finalizeDecision(decision, stateSchema.parse({}))).toThrow("invalid source");
});

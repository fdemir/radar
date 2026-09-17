import { expect, it, vi } from "vitest";
import type { TaskInput } from "@radar/core";
import { createResearch } from "../../../packages/agent/src/research";
import { createResearchModel } from "../../../packages/agent/src/research-model";
import {
  ResearchCancelled,
  ResearchError,
  stateSchema,
} from "../../../packages/agent/src/research-state";
import type { createRetrieval } from "../../../packages/agent/src/retrieval";

const task: TaskInput = {
  title: "Hono releases",
  brief: "Find the latest stable Hono release from official notes.",
  category: "Technology",
  status: "active",
  frequency: "Daily",
  time: "09:00",
  language: "English",
  email: true,
  messages: [],
  revision: 0,
};
const config = {
  OPENAI_API_KEY: "test-key",
  OPENAI_BASE_URL: "https://model.example.com/v1",
  OPENAI_MODEL: "test-model",
};
const modelInput = () => ({
  task,
  previous: [],
  state: stateSchema.parse({}),
  finalTurn: false,
  today: "2026-09-17",
  signal: new AbortController().signal,
});

function workflow() {
  const model = vi.fn<ReturnType<typeof createResearchModel>>();
  const search = vi.fn<ReturnType<typeof createRetrieval>["search"]>();
  const read = vi.fn<ReturnType<typeof createRetrieval>["read"]>();
  const now = vi.fn(() => Date.UTC(2026, 8, 17));
  const research = createResearch({ model, sources: () => ({ search, read }), now });

  return { research, model, search, read, now };
}

it("stops before calling providers when progress reports cancellation", async () => {
  const { research, model, search, read } = workflow();

  await expect(research(task, [], async () => false)).rejects.toBeInstanceOf(ResearchCancelled);
  expect(model).not.toHaveBeenCalled();
  expect(search).not.toHaveBeenCalled();
  expect(read).not.toHaveBeenCalled();
});

it("preserves finding emphasis while keeping headlines and run history plain", async () => {
  const { research, model } = workflow();

  model.mockResolvedValue({
    role: "assistant",
    content: JSON.stringify({
      summary: "Hono **5.0** is available.",
      findings: [
        {
          title: "Hono **5.0** released",
          summary: "Includes **streaming support**.",
          reason: "A **stable** release.",
          evidence: "Hono 5.0 is stable and includes streaming support.",
          url: "https://hono.dev/release",
          eventKey: "hono-release",
          version: "5.0",
        },
      ],
      needsMoreEvidence: false,
    }),
  });

  const result = await research(task, [], async () => true, {
    checkpoint: {
      version: 2,
      next: "model",
      state: stateSchema.parse({
        searched: ["Hono releases"],
        sources: [
          {
            url: "https://hono.dev/release",
            title: "Hono releases",
            content: "Hono 5.0 is stable and includes streaming support.",
          },
        ],
      }),
    },
  });

  expect(result.summary).toBe("Hono 5.0 is available.");
  expect(result.findings[0]).toMatchObject({
    title: "Hono 5.0 released",
    summary: "Includes **streaming support**.",
    reason: "A stable release.",
    evidence: "Hono 5.0 is stable and includes streaming support.",
  });
});

it("does not execute a model's tool request after losing its checkpoint lease", async () => {
  const { research, model, search } = workflow();

  model.mockResolvedValue({
    role: "assistant",
    content: null,
    tool_calls: [
      {
        id: "search-1",
        type: "function",
        function: { name: "searchWeb", arguments: JSON.stringify({ query: "Hono releases" }) },
      },
    ],
  });

  await expect(
    research(task, [], async () => true, { saveCheckpoint: async () => false }),
  ).rejects.toBeInstanceOf(ResearchCancelled);
  expect(model).toHaveBeenCalledTimes(1);
  expect(search).not.toHaveBeenCalled();
});

it("uses its last turn to finish when the time budget is nearly exhausted", async () => {
  const { research, model, search, read, now } = workflow();
  const started = now();

  now.mockReturnValueOnce(started).mockReturnValue(started + 240_000);
  model.mockResolvedValue({
    role: "assistant",
    content: null,
    tool_calls: [
      {
        id: "too-late",
        type: "function",
        function: { name: "searchWeb", arguments: JSON.stringify({ query: "Hono releases" }) },
      },
    ],
  });

  const result = await research(task, [], async () => true);

  expect(model).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ finalTurn: true, today: "2026-09-17" }),
  );
  expect(result).toMatchObject({ findings: [], coverage: "limited" });
  expect(search).not.toHaveBeenCalled();
  expect(read).not.toHaveBeenCalled();
});

it("keeps the provider status as the cause of a user-safe model error", async () => {
  vi.useFakeTimers();

  const model = createResearchModel(
    config,
    async () => new Response("private details", { status: 503 }),
  );

  const done = expect(model(modelInput())).rejects.toMatchObject({
    constructor: ResearchError,
    message: "Research assistant is unavailable. Try again later.",
    cause: new Error("Model provider returned HTTP 503."),
  });

  await vi.advanceTimersByTimeAsync(4000);
  await done;
  vi.useRealTimers();
});

it("preserves the cause of a network failure", async () => {
  vi.useFakeTimers();

  const cause = new TypeError("Connection reset");
  const model = createResearchModel(config, async () => {
    throw cause;
  });

  const done = expect(model(modelInput())).rejects.toMatchObject({
    constructor: ResearchError,
    cause,
  });

  await vi.advanceTimersByTimeAsync(4000);
  await done;
  vi.useRealTimers();
});

it.each([
  "not JSON",
  JSON.stringify({ choices: [] }),
  JSON.stringify({ choices: [{ message: { role: "user", content: "unexpected role" } }] }),
])("classifies a malformed model envelope as a research error: %s", async (body) => {
  const model = createResearchModel(config, async () => new Response(body));

  await expect(model(modelInput())).rejects.toMatchObject({
    constructor: ResearchError,
    message: "The assistant returned an incomplete response. Try again.",
    cause: expect.any(Error),
  });
});

it("keeps cancellation distinct from a provider failure", async () => {
  const controller = new AbortController();
  const reason = new Error("Research was cancelled");
  const model = createResearchModel(config, async () => {
    controller.abort(reason);
    throw reason;
  });

  await expect(model({ ...modelInput(), signal: controller.signal })).rejects.toBe(reason);
});

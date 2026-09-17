import { END, START, StateGraph, StateSchema } from "@langchain/langgraph";
import type { TaskInput } from "@radar/core";
import type { ResearchResult } from "@radar/core/research";
import type { createResearchModel } from "./research-model";
import type { createRetrieval } from "./retrieval";
import { executeResearchTool } from "./research-tools";
import { applyModelDecision, applyToolResult } from "./research-transitions";
import { restoreCheckpoint } from "./research-checkpoint";
import {
  researchLimits,
  researchStages,
  ResearchCancelled,
  ResearchError,
  stateSchema,
  type PreviousFinding,
  type ResearchOptions,
  type ResearchProgress,
  type ResearchStage,
  type ResearchState,
} from "./research-state";

type ResearchDependencies = {
  model: ReturnType<typeof createResearchModel>;
  sources: (
    brief: string,
    signal: AbortSignal,
    hooks: ResearchOptions & { deadline: number },
  ) => ReturnType<typeof createRetrieval>;
  now?: () => number;
};

export function createResearch({ model, sources, now = Date.now }: ResearchDependencies) {
  return async (
    task: TaskInput,
    previous: PreviousFinding[],
    progress: ResearchProgress,
    options: ResearchOptions = {},
  ): Promise<ResearchResult> => {
    const signal = AbortSignal.timeout(researchLimits.durationMs);
    const started = now();
    const today = new Date(started).toISOString().slice(0, 10);
    const checkpoint = restoreCheckpoint(options.checkpoint);
    const requests = {
      ...options,
      attempts: [...(options.attempts ?? [])],
      deadline: started + researchLimits.durationMs,
    };
    const retrieval = sources(task.brief, signal, requests);
    const nextNode = (state: ResearchState) => state.execution.phase;
    const nodeNames = ["model", "tools", "finish"] as const;

    async function step(stage: ResearchStage, state: ResearchState) {
      signal.throwIfAborted();

      if (
        !(await progress(
          stage,
          state.sources.map((source) => source.url),
        ))
      )
        throw new ResearchCancelled();
    }

    const persist =
      (action: (state: ResearchState) => Promise<ResearchState>) =>
      async (state: ResearchState) => {
        const updated = await action(state);

        if (
          options.saveCheckpoint &&
          !(await options.saveCheckpoint({ version: 3, state: updated }))
        )
          throw new ResearchCancelled();

        return updated;
      };

    const graph = new StateGraph(new StateSchema(stateSchema.shape))
      .addNode(
        "model",
        persist(async (state) => {
          await step(
            state.sources.length ? researchStages.evaluating : researchStages.searching,
            state,
          );

          const finalTurn =
            state.turns >= researchLimits.turns - 1 ||
            now() - started >= researchLimits.finalTurnAfterMs;
          const decision = await model({
            task,
            previous,
            state,
            finalTurn,
            today,
            signal,
            requests,
          });

          return applyModelDecision(state, decision, finalTurn, task.language);
        }),
      )
      .addNode(
        "tools",
        persist(async (state) => {
          if (state.execution.phase !== "tools") throw new Error("No pending research tools.");

          const toolState = { ...state, execution: state.execution };
          const outcome = await executeResearchTool(toolState, {
            brief: task.brief,
            signal,
            retrieval,
            step,
          });

          return applyToolResult(toolState, outcome);
        }),
      )
      .addNode("finish", async (state) => {
        await step(researchStages.finishing, state);

        if (state.searchFailures && state.searchFailures === state.searched.length)
          throw new ResearchError("Web search is unavailable. Try again later.");

        return {};
      })
      .addConditionalEdges(START, () => checkpoint?.state.execution.phase ?? "model", [
        ...nodeNames,
      ])
      .addConditionalEdges("model", nextNode, [...nodeNames])
      .addConditionalEdges("tools", nextNode, [...nodeNames])
      .addEdge("finish", END)
      .compile();
    const state = await graph.invoke(checkpoint?.state ?? {}, { signal, recursionLimit: 96 });

    if (state.execution.phase !== "finish")
      throw new ResearchError("Research did not finish. Try again.");

    return {
      ...state.execution.result,
      sources: state.sources.map((source) => source.url),
      coverage: state.limited ? "limited" : "complete",
    };
  };
}

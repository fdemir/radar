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

    let state = checkpoint?.state ?? stateSchema.parse({});
    let steps = 0;
    const maxSteps = researchLimits.turns * (researchLimits.toolCalls + 1);

    while (state.execution.phase !== "finish") {
      signal.throwIfAborted();

      if (steps++ >= maxSteps) throw new ResearchError("Research exceeded its step budget.");

      if (state.execution.phase === "model") {
        await step(
          state.sources.length ? researchStages.evaluating : researchStages.searching,
          state,
        );

        const finalTurn =
          state.turns >= researchLimits.turns - 1 ||
          now() - started >= researchLimits.finalTurnAfterMs;
        const decision = await model({ task, previous, state, finalTurn, today, signal, requests });

        state = applyModelDecision(state, decision, finalTurn, task.language);
      } else {
        const toolState = { ...state, execution: state.execution };
        const outcome = await executeResearchTool(toolState, {
          brief: task.brief,
          signal,
          retrieval,
          step,
        });

        state = applyToolResult(toolState, outcome);
      }

      // Persist each model decision and each completed call before starting more work.
      if (options.saveCheckpoint && !(await options.saveCheckpoint({ version: 3, state })))
        throw new ResearchCancelled();
    }

    await step(researchStages.finishing, state);

    if (state.searchFailures && state.searchFailures === state.searched.length)
      throw new ResearchError("Web search is unavailable. Try again later.");

    return {
      ...state.execution.result,
      sources: state.sources.map((source) => source.url),
      coverage: state.limited ? "limited" : "complete",
    };
  };
}

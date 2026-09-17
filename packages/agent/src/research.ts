import { END, START, StateGraph, StateSchema } from "@langchain/langgraph";
import type { TaskInput } from "@radar/core";
import { publicUrl, type ResearchResult } from "@radar/core/research";
import type z from "zod";
import { type createResearchModel, decisionSchema } from "./research-model";
import type { createRetrieval } from "./retrieval";
import { executeResearchTool } from "./research-tools";
import {
  nodeNames,
  researchLimits,
  researchStages,
  ResearchCancelled,
  ResearchError,
  restoreCheckpoint,
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
    const nextNode = (state: ResearchState) =>
      state.pending.length ? "tools" : state.result ? "finish" : "model";
    const emptyResult = {
      summary: task.language === "Türkçe" ? "Yeni eşleşme yok." : "No new matches.",
      findings: [],
    };

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
      (action: (state: ResearchState) => Promise<Partial<ResearchState>>) =>
      async (state: ResearchState) => {
        const change = await action(state);
        const updated = { ...state, ...change };

        if (
          options.saveCheckpoint &&
          !(await options.saveCheckpoint({ version: 2, next: nextNode(updated), state: updated }))
        )
          throw new ResearchCancelled();

        return change;
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
          const reply = await model({ task, previous, state, finalTurn, today, signal, requests });
          const turns = state.turns + 1;
          const messages = [...state.messages, reply];

          if (reply.tool_calls?.length) {
            if (finalTurn) return { turns, limited: true, result: emptyResult };

            return { turns, messages, pending: reply.tool_calls };
          }

          let result: z.output<typeof decisionSchema>;

          try {
            result = decisionSchema.parse(JSON.parse(reply.content ?? ""));
          } catch (cause) {
            if (finalTurn)
              throw new ResearchError("The assistant returned an incomplete response. Try again.", {
                cause,
              });

            return {
              turns,
              messages: [
                ...messages,
                {
                  role: "user" as const,
                  content:
                    "Your response was not a valid result. Continue with the available tools, or return a JSON result matching the required schema.",
                },
              ],
            };
          }

          const findings = result.findings.map((item) => {
            const url = publicUrl(item.url);
            const source = state.sources.find((source) => source.url === url);

            if (!source) throw new ResearchError("A finding had an invalid source. Try again.");

            const normalize = (text: string) => text.replace(/\s+/gu, " ").trim();
            const evidence = normalize(item.evidence);

            return {
              ...item,
              url: source.url,
              evidence:
                evidence.length >= 12 && normalize(source.content).includes(evidence)
                  ? evidence
                  : "",
              eventKey: item.eventKey.trim().toLowerCase(),
              version: item.version.trim().toLowerCase(),
            };
          });
          const unverifiedQuotes = result.findings.filter(
            (item, index) => item.evidence && !findings[index]!.evidence,
          );

          return {
            turns,
            messages,
            result: { summary: result.summary, findings },
            limited:
              state.limited ||
              result.needsMoreEvidence ||
              unverifiedQuotes.length > 0 ||
              !state.searched.length ||
              (state.candidates.length > 0 && !state.sources.length),
          };
        }),
      )
      .addNode(
        "tools",
        persist((state) =>
          executeResearchTool(state, {
            brief: task.brief,
            signal,
            retrieval,
            step,
          }),
        ),
      )
      .addNode("finish", async (state) => {
        await step(researchStages.finishing, state);

        if (state.searchFailures && state.searchFailures === state.searched.length)
          throw new ResearchError("Web search is unavailable. Try again later.");

        return {};
      })
      .addConditionalEdges(START, () => checkpoint?.next ?? "model", [...nodeNames])
      .addConditionalEdges("model", nextNode, [...nodeNames])
      .addConditionalEdges("tools", nextNode, [...nodeNames])
      .addEdge("finish", END)
      .compile();
    const state = await graph.invoke(checkpoint?.state ?? {}, { signal, recursionLimit: 96 });

    if (!state.result) throw new ResearchError("Research did not finish. Try again.");

    return {
      ...state.result,
      sources: state.sources.map((source) => source.url),
      coverage: state.limited ? "limited" : "complete",
    };
  };
}

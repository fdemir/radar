import { publicUrl, ResearchDeferred } from "@radar/core/research";
import { type createRetrieval, searchUrl } from "./retrieval";
import {
  researchLimits,
  researchStages,
  ResearchCancelled,
  type ResearchStage,
  type ResearchState,
  type ToolState,
} from "./research-state";

type ToolContext = {
  brief: string;
  signal: AbortSignal;
  retrieval: ReturnType<typeof createRetrieval>;
  step: (stage: ResearchStage, state: ResearchState) => Promise<void>;
};

export async function executeResearchTool(
  state: ToolState,
  { brief, signal, retrieval, step }: ToolContext,
): Promise<ToolOutcome> {
  const call = state.execution.pending[0]!;
  const reply = (output: unknown, changes: ToolOutcome["changes"] = {}): ToolOutcome => ({
    content: JSON.stringify(output),
    changes,
  });

  if (call.name === "searchWeb") {
    await step(state.sources.length ? researchStages.expanding : researchStages.searching, state);

    const query = call.input;
    const url = searchUrl(query, brief).href;
    const output = { query: query.query, results: [] };

    if (state.searched.includes(url))
      return reply({
        ...output,
        error: "This search was already attempted. Use its earlier results.",
      });

    if (
      state.searched.length >= researchLimits.searches ||
      (state.attempted.length && state.followups >= researchLimits.followupSearches)
    )
      return reply({
        ...output,
        error: "Search budget exhausted. Use existing evidence and finish.",
      });

    const change = {
      searched: [...state.searched, url],
      followups: state.followups + Number(state.attempted.length > 0),
    };

    try {
      const results = await retrieval.search(query, `tool:${call.id}`);

      return reply(
        { query: query.query, results },
        { ...change, candidates: [...state.candidates, ...results] },
      );
    } catch (error) {
      if (error instanceof ResearchDeferred || error instanceof ResearchCancelled) throw error;

      signal.throwIfAborted();

      return reply(
        { ...output, error: "Web search is unavailable. Try another query if useful." },
        { ...change, limited: true, searchFailures: state.searchFailures + 1 },
      );
    }
  }

  if (call.name === "scrapeWebsite") {
    await step(researchStages.reading, state);

    const url = publicUrl(call.input.url);

    if (!url)
      return reply({
        error: "Choose a public HTTP or HTTPS URL without credentials or a private address.",
      });

    const existing = state.sources.find((source) => source.url === url);

    if (existing) return reply(existing);

    if (state.attempted.includes(url))
      return reply({
        url,
        error: "This page was already attempted and could not be read.",
      });

    if (state.attempted.length >= researchLimits.pageReads)
      return reply({
        url,
        error: "Page budget exhausted. Use existing evidence and finish.",
      });

    const attempted = [...state.attempted, url];

    try {
      const source = await retrieval.read(
        url,
        state.candidates.find((item) => item.url === url)?.title ?? url,
        `tool:${call.id}`,
      );

      if (!source)
        return reply(
          {
            url,
            error: "This page could not be read. Its search snippet remains an unverified lead.",
          },
          { attempted, limited: true },
        );

      return reply(source, {
        attempted,
        sources: [...new Map([...state.sources, source].map((item) => [item.url, item])).values()],
      });
    } catch (error) {
      if (error instanceof ResearchDeferred || error instanceof ResearchCancelled) throw error;

      signal.throwIfAborted();

      return reply(
        { url, error: "Source reading is unavailable. Use another source if useful." },
        { attempted, limited: true },
      );
    }
  }

  return reply({
    error:
      "Invalid tool or arguments. Use searchWeb with a valid query, or scrapeWebsite with a public URL.",
  });
}

export type ToolOutcome = {
  content: string;
  changes: Partial<
    Pick<
      ResearchState,
      | "searched"
      | "followups"
      | "candidates"
      | "limited"
      | "searchFailures"
      | "attempted"
      | "sources"
    >
  >;
};

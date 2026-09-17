import z from "zod";
import { publicUrl, ResearchDeferred } from "@radar/core/research";
import { type createRetrieval, searchQuerySchema, searchUrl } from "./retrieval";
import {
  researchLimits,
  researchStages,
  type ResearchOptions,
  type ResearchStage,
  type ResearchState,
} from "./research-state";

type ToolContext = {
  brief: string;
  signal: AbortSignal;
  retrieval: ReturnType<typeof createRetrieval>;
  reserve: ResearchOptions["reserve"];
  step: (stage: ResearchStage, state: ResearchState) => Promise<void>;
};

export async function executeResearchTool(
  state: ResearchState,
  { brief, signal, retrieval, reserve, step }: ToolContext,
): Promise<Partial<ResearchState>> {
  const call = state.pending[0]!;
  const reply = (output: unknown, change: Partial<ResearchState> = {}): Partial<ResearchState> => ({
    ...change,
    pending: state.pending.slice(1),
    messages: [
      ...state.messages,
      { role: "tool", tool_call_id: call.id, content: JSON.stringify(output) },
    ],
  });
  let args: unknown;

  try {
    args = JSON.parse(call.function.arguments);
  } catch {
    return reply({ error: "Tool arguments must be valid JSON." });
  }

  if (call.function.name === "searchWeb") {
    await step(state.sources.length ? researchStages.expanding : researchStages.searching, state);

    const query = searchQuerySchema.safeParse(args);

    if (!query.success)
      return reply({ error: "Provide a short query and valid optional search filters." });

    const url = searchUrl(query.data, brief).href;
    const output = { query: query.data.query, results: [] };

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

    await reserve?.("search", 1);

    const change = {
      searched: [...state.searched, url],
      followups: state.followups + Number(state.attempted.length > 0),
    };

    try {
      const results = await retrieval.search(query.data);

      return reply(
        { query: query.data.query, results },
        { ...change, candidates: [...state.candidates, ...results] },
      );
    } catch (error) {
      if (error instanceof ResearchDeferred) throw error;

      signal.throwIfAborted();

      return reply(
        { ...output, error: "Web search is unavailable. Try another query if useful." },
        { ...change, limited: true, searchFailures: state.searchFailures + 1 },
      );
    }
  }

  if (call.function.name === "scrapeWebsite") {
    await step(researchStages.reading, state);

    const parsed = z.object({ url: z.string() }).safeParse(args);
    const url = parsed.success ? publicUrl(parsed.data.url) : null;

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

    await reserve?.("fetch", 1);

    const attempted = [...state.attempted, url];

    try {
      const source = await retrieval.read(
        url,
        state.candidates.find((item) => item.url === url)?.title ?? url,
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
      if (error instanceof ResearchDeferred) throw error;

      signal.throwIfAborted();

      return reply(
        { url, error: "Source reading is unavailable. Use another source if useful." },
        { attempted, limited: true },
      );
    }
  }

  return reply({ error: "Unknown tool. Use searchWeb or scrapeWebsite." });
}

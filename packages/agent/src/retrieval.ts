import z from "zod";
import { publicUrl } from "@radar/core/research";

export const searchQuerySchema = z.object({
  query: z.string().trim().min(1).max(400),
  location: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .optional(),
  language: z
    .string()
    .regex(/^[a-z]{2}$/)
    .optional(),
  include_domains: z
    .array(z.string().regex(/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/))
    .max(5)
    .optional(),
  recency_minutes: z.number().int().min(1).max(5256000).optional(),
});

export const searchSourceSchema = z.object({
  url: z.string(),
  title: z.string(),
  snippet: z.string(),
  query: z.string(),
  position: z.number(),
});

export type SearchSource = z.infer<typeof searchSourceSchema>;

export function searchUrl(query: z.infer<typeof searchQuerySchema>, brief: string) {
  const url = new URL("https://api.search.tinyfish.ai");

  url.searchParams.set("query", query.query);
  url.searchParams.set("purpose", brief.slice(0, 2000));

  for (const key of ["location", "language", "include_domains", "recency_minutes"] as const) {
    const value = query[key];

    if (value !== undefined && (!Array.isArray(value) || value.length))
      url.searchParams.set(key, Array.isArray(value) ? value.join(",") : String(value));
  }

  return url;
}

// Rank inexpensive search snippets before spending the page-reading budget.
// Penalize repeated queries and domains so one result list cannot fill every slot.
export function selectSources(candidates: SearchSource[], brief: string, excluded: string[]) {
  const terms = [...new Set(brief.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])];
  const seen = new Set(excluded);
  const pool = candidates.flatMap((source) => {
    const url = publicUrl(source.url);

    if (!url || seen.has(url)) return [];

    seen.add(url);

    return [{ ...source, url }];
  });
  const selected: SearchSource[] = [];
  const domains = new Map<string, number>();
  const queries = new Map<string, number>();

  while (pool.length && selected.length < 5) {
    const score = (source: SearchSource) => {
      const text = `${source.title} ${source.snippet}`.toLowerCase();
      const relevance =
        terms.filter((term) => text.includes(term)).length / Math.max(1, terms.length);

      return (
        relevance * 3 +
        1 / Math.max(1, source.position) -
        (domains.get(new URL(source.url).hostname) ?? 0) * 2 -
        (queries.get(source.query) ?? 0) * 2
      );
    };

    pool.sort((a, b) => score(b) - score(a));

    const next = pool.shift()!;
    const domain = new URL(next.url).hostname;

    selected.push(next);
    domains.set(domain, (domains.get(domain) ?? 0) + 1);
    queries.set(next.query, (queries.get(next.query) ?? 0) + 1);
  }

  return selected;
}

import z from "zod";
import { publicUrl, ResearchDeferred, type ResearchService } from "@radar/core/research";

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
  snippet: z.string().default(""),
});

export const sourceSchema = z.object({
  url: z.string(),
  title: z.string(),
  content: z.string(),
  links: z.array(z.string()).default([]),
});

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

export function publicLinks(values: string[]) {
  return [...new Set(values.flatMap((value) => publicUrl(value) ?? []))];
}

export function createRetrieval(
  key: string,
  brief: string,
  signal: AbortSignal,
  backoff?: (service: ResearchService, retryAt: number) => Promise<void>,
) {
  async function request(url: string, service: ResearchService, body?: unknown) {
    const response = await fetch(url, {
      method: body ? "POST" : "GET",
      headers: { "X-API-Key": key, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.any([signal, AbortSignal.timeout(body ? 45_000 : 30_000)]),
      redirect: "manual",
    });

    if (response.status === 429) {
      const header = response.headers.get("Retry-After");
      const delay =
        header && /^\d+$/.test(header)
          ? Number(header) * 1000
          : header
            ? Date.parse(header) - Date.now()
            : 60_000;
      const retryAt = Date.now() + Math.max(1000, Number.isFinite(delay) ? delay : 60_000);

      await backoff?.(service, retryAt);
      throw new ResearchDeferred(retryAt);
    }

    if (!response.ok) throw new Error("Provider request failed.");

    return response.json();
  }

  return {
    async search(query: z.infer<typeof searchQuerySchema>) {
      const parsed = z
        .object({ results: z.array(searchSourceSchema) })
        .parse(await request(searchUrl(query, brief).href, "search"));
      const seen = new Set<string>();

      return parsed.results
        .flatMap((item) => {
          const url = publicUrl(item.url);

          if (!url || seen.has(url)) return [];

          seen.add(url);

          return [{ url, title: item.title.slice(0, 300), snippet: item.snippet.slice(0, 2000) }];
        })
        .slice(0, 10);
    },
    async read(url: string, title: string) {
      const parsed = z
        .object({
          results: z.array(
            z.object({
              url: z.string(),
              final_url: z.string(),
              title: z.string().nullable().optional(),
              text: z.string().nullable(),
              links: z.array(z.string()).optional(),
            }),
          ),
        })
        .parse(
          await request("https://api.fetch.tinyfish.ai", "fetch", {
            urls: [url],
            purpose: brief.slice(0, 2000),
            format: "markdown",
            links: true,
            ttl: 0,
            per_url_timeout_ms: 25000,
          }),
        );
      const page = parsed.results.find((item) => publicUrl(item.url) === url);
      const finalUrl = page && publicUrl(page.final_url);

      if (!page?.text?.trim() || !finalUrl) return null;

      return {
        url: finalUrl,
        title: page.title || title,
        content: page.text.slice(0, 7000),
        links: publicLinks(page.links ?? []).slice(0, 80),
      };
    },
  };
}

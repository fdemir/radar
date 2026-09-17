import z from "zod";
import { publicUrl, type ResearchRequestHooks, type ResearchService } from "@radar/core/research";
import { ProviderError, requestProvider } from "./provider-request";

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
  hooks: ResearchRequestHooks & { deadline?: number } = {},
) {
  function request<T>(
    url: string,
    service: ResearchService,
    operation: string,
    target: string,
    parse: (body: unknown) => T,
    body?: unknown,
  ) {
    return requestProvider({
      ...hooks,
      service,
      operation,
      target,
      signal,
      timeoutMs: body ? 45_000 : 30_000,
      parse,
      send: (signal) =>
        fetch(url, {
          method: body ? "POST" : "GET",
          headers: { "X-API-Key": key, ...(body ? { "Content-Type": "application/json" } : {}) },
          body: body ? JSON.stringify(body) : undefined,
          signal,
          redirect: "manual",
        }),
    });
  }

  return {
    async search(query: z.infer<typeof searchQuerySchema>, operation = crypto.randomUUID()) {
      const parsed = await request(
        searchUrl(query, brief).href,
        "search",
        operation,
        query.query,
        (body) => z.object({ results: z.array(searchSourceSchema) }).parse(body),
      );
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
    async read(url: string, title: string, operation = crypto.randomUUID()) {
      try {
        return await request(
          "https://api.fetch.tinyfish.ai",
          "fetch",
          operation,
          url,
          (body) => {
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
                errors: z
                  .array(
                    z.object({
                      url: z.string(),
                      error: z.string(),
                      status: z.number().int().optional(),
                    }),
                  )
                  .default([]),
              })
              .parse(body);
            const page = parsed.results.find((item) => publicUrl(item.url) === url);
            const finalUrl = page && publicUrl(page.final_url);
            const failure = parsed.errors.find((item) => publicUrl(item.url) === url);

            if (!page?.text?.trim() && failure) {
              const kind =
                failure.error === "timeout"
                  ? "timeout"
                  : ["target_unreachable", "proxy_error"].includes(failure.error)
                    ? "network"
                    : ["target_http_error", "page_not_found"].includes(failure.error)
                      ? "http"
                      : failure.error === "empty_content"
                        ? "empty_response"
                        : ["invalid_url", "invalid_redirect_url"].includes(failure.error)
                          ? "invalid_source"
                          : "source_error";

              throw new ProviderError(kind, failure.status ?? null, undefined, failure.error);
            }

            if (!page?.text?.trim()) throw new ProviderError("empty_response");

            if (!finalUrl) throw new ProviderError("invalid_source");

            return {
              url: finalUrl,
              title: page.title || title,
              content:
                page.text.length <= 30000
                  ? page.text
                  : `${page.text.slice(0, 22000)}\n\n[Middle of page omitted]\n\n${page.text.slice(-8000)}`,
              links: publicLinks(page.links ?? []).slice(0, 80),
            };
          },
          {
            urls: [url],
            purpose: brief.slice(0, 2000),
            format: "markdown",
            links: true,
            ttl: 0,
            per_url_timeout_ms: 25000,
          },
        );
      } catch (error) {
        if (
          error instanceof ProviderError &&
          ["empty_response", "invalid_source"].includes(error.kind)
        )
          return null;

        throw error;
      }
    },
  };
}

import z from "zod";

export const candidateSchema = z.object({
  title: z.string().min(1).max(200),
  summary: z.string().min(1).max(1500),
  reason: z.string().min(1).max(500),
  evidence: z.string().max(600).optional(),
  url: z.url(),
  eventKey: z.string().min(1).max(200),
  version: z.string().min(1).max(200),
});

export type Candidate = z.infer<typeof candidateSchema>;

export const researchResultSchema = z.object({
  summary: z.string().min(1).max(500),
  findings: z.array(candidateSchema).max(5),
});

export type ResearchResult = z.infer<typeof researchResultSchema> & {
  sources: string[];
  coverage?: "complete" | "limited";
};

export type ResearchJob = { runId: string };

export function publicUrl(value: string): string | null {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/\.$/, "");

    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.port)
      return null;

    if (!host.includes(".") || /^[\d.]+$/.test(host) || host.includes(":") || host.startsWith("["))
      return null;

    if (/(^|\.)(localhost|local|internal|test|invalid|example|onion|lan|home)$/.test(host))
      return null;

    url.hash = "";

    const tracking = [...url.searchParams.keys()].filter((key) =>
      /^(utm_|fbclid$|gclid$)/i.test(key),
    );

    for (const key of tracking) url.searchParams.delete(key);

    return url.href;
  } catch {
    return null;
  }
}

export type ResearchService = "search" | "fetch";

export type ResearchAttempt = {
  operation: string;
  service: ResearchService | "model";
  target: string;
  attempt: number;
  started: number;
  durationMs: number;
  status: number | null;
  sourceStatus: number | null;
  code: string | null;
  error:
    | "http"
    | "network"
    | "timeout"
    | "rate_limit"
    | "invalid_response"
    | "empty_response"
    | "invalid_source"
    | "source_error"
    | "cancelled"
    | null;
  retryAt: number | null;
};

export type ResearchRequestHooks = {
  attempts?: ResearchAttempt[];
  recordAttempt?: (attempt: ResearchAttempt) => Promise<void>;
  beforeAttempt?: () => Promise<void>;
  reserve?: (service: ResearchService, amount: number) => Promise<void>;
  backoff?: (service: ResearchService, retryAt: number) => Promise<void>;
};

export class ResearchDeferred extends Error {
  constructor(public readonly retryAt: number) {
    super("Waiting for service capacity. This check will resume automatically.");
  }
}

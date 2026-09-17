import {
  ResearchDeferred,
  type ResearchAttempt,
  type ResearchRequestHooks,
} from "@radar/core/research";

const transientStatuses = new Set([500, 502, 503, 504]);

export class ProviderError extends Error {
  constructor(
    public readonly kind: NonNullable<ResearchAttempt["error"]>,
    public readonly status: number | null = null,
    options?: ErrorOptions,
    public readonly code: string | null = null,
  ) {
    super(
      `Provider request failed (${kind}${status === null ? "" : `, HTTP ${status}`}).`,
      options,
    );
  }
}

type ProviderRequest<T> = ResearchRequestHooks & {
  service: ResearchAttempt["service"];
  operation: string;
  target: string;
  signal: AbortSignal;
  deadline?: number;
  timeoutMs: number;
  send: (signal: AbortSignal) => Promise<Response>;
  parse: (body: unknown) => T;
};

function safeTarget(value: string) {
  try {
    const url = new URL(value);

    url.username = "";
    url.password = "";
    url.hash = "";

    const keys = [...url.searchParams.keys()];

    for (const key of keys) {
      if (/key|token|secret|password|authorization|signature|credential/i.test(key))
        url.searchParams.set(key, "REDACTED");
    }

    return url.href.slice(0, 2000);
  } catch {
    return value.slice(0, 400);
  }
}

function wait(ms: number, signal: AbortSignal) {
  signal.throwIfAborted();

  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };

    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);

    signal.addEventListener("abort", abort, { once: true });
  });
}

function retryTime(header: string | null, now: number) {
  const delay =
    header && /^\d+$/.test(header)
      ? Number(header) * 1000
      : header
        ? Date.parse(header) - now
        : 60_000;

  return now + Math.max(1000, Number.isFinite(delay) ? delay : 60_000);
}

// Owns transport retries, response validation and safe diagnostics for every research provider.
export async function requestProvider<T>(options: ProviderRequest<T>): Promise<T> {
  const { service, operation, signal, timeoutMs } = options;
  const prior = options.attempts?.filter((item) => item.operation === operation) ?? [];
  let number = prior.length;
  let failures = prior.filter(
    (item) =>
      item.error === "network" ||
      item.error === "timeout" ||
      (item.error === "http" && transientStatuses.has(item.sourceStatus ?? item.status ?? 0)),
  ).length;
  let timeouts = prior.filter((item) => item.error === "timeout").length;

  while (true) {
    signal.throwIfAborted();

    if (Date.now() >= (options.deadline ?? Infinity))
      throw new DOMException("Research time budget exhausted.", "TimeoutError");

    await options.beforeAttempt?.();

    if (service !== "model") await options.reserve?.(service, 1);

    signal.throwIfAborted();

    const started = Date.now();
    const remaining = (options.deadline ?? Infinity) - started;

    if (remaining <= 0) throw new DOMException("Research time budget exhausted.", "TimeoutError");

    const timeout = AbortSignal.timeout(Math.max(1, Math.min(timeoutMs, remaining)));
    const requestSignal = AbortSignal.any([signal, timeout]);
    let status: number | null = null;
    let result: T | undefined;
    let failure: ProviderError | undefined;
    let deferredUntil: number | null = null;

    try {
      const response = await options.send(requestSignal);

      status = response.status;

      if (status === 429) {
        deferredUntil = retryTime(response.headers.get("Retry-After"), Date.now());
        await response.body?.cancel();
        throw new ProviderError("rate_limit", status);
      }

      if (!response.ok) {
        await response.body?.cancel();
        throw new ProviderError("http", status);
      }

      const body: unknown = await response.json();

      requestSignal.throwIfAborted();

      try {
        result = options.parse(body);
      } catch (cause) {
        throw cause instanceof ProviderError
          ? cause
          : new ProviderError("invalid_response", status, { cause });
      }
    } catch (cause) {
      failure = signal.aborted
        ? new ProviderError("cancelled", status)
        : timeout.aborted || (cause instanceof Error && cause.name === "TimeoutError")
          ? new ProviderError("timeout", status, { cause })
          : cause instanceof ProviderError
            ? cause
            : new ProviderError(
                cause instanceof SyntaxError ? "invalid_response" : "network",
                status,
                { cause },
              );
    }

    if (failure?.kind === "timeout") timeouts++;

    const transient =
      failure &&
      (failure.kind === "network" ||
        failure.kind === "timeout" ||
        (failure.kind === "http" && transientStatuses.has(failure.status ?? status ?? 0)));

    if (transient) failures++;

    const delay = failures <= 1 ? 1000 : 3000;
    const retry = Boolean(
      transient &&
      failures < 3 &&
      timeouts < 2 &&
      !signal.aborted &&
      Date.now() + delay + timeoutMs <= (options.deadline ?? Infinity),
    );
    const attempt: ResearchAttempt = {
      service,
      operation,
      target: safeTarget(options.target),
      attempt: ++number,
      started,
      durationMs: Math.max(0, Date.now() - started),
      status,
      sourceStatus: status === 200 ? (failure?.status ?? null) : null,
      code: failure?.code && /^[a-z_]{1,64}$/.test(failure.code) ? failure.code : null,
      error: failure?.kind ?? null,
      retryAt: deferredUntil ?? (retry ? Date.now() + delay : null),
    };

    await options.recordAttempt?.(attempt);
    options.attempts?.push(attempt);
    signal.throwIfAborted();

    if (deferredUntil !== null) {
      if (service !== "model") await options.backoff?.(service, deferredUntil);

      throw new ResearchDeferred(deferredUntil);
    }

    if (!failure) return result!;

    if (!retry) throw failure;

    await wait(delay, signal);
  }
}

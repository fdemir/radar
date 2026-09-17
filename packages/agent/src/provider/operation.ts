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
    options?: ErrorOptions & { providerStatus?: number; retryAfter?: string | null },
    public readonly code: string | null = null,
  ) {
    super(
      `Provider request failed (${kind}${status === null ? "" : `, HTTP ${status}`}).`,
      options,
    );
    this.providerStatus = options?.providerStatus ?? status;
    this.retryAfter = options?.retryAfter ?? null;
  }

  readonly providerStatus: number | null;
  readonly retryAfter: string | null;
}

type ProviderOperation<T> = ResearchRequestHooks & {
  service: ResearchAttempt["service"];
  operation: string;
  target: string;
  signal: AbortSignal;
  deadline?: number;
  timeoutMs: number;
  execute: (signal: AbortSignal) => Promise<{ value: T; status: number }>;
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

// Owns attempt budgets, cancellation, quota deferral and safe diagnostics across transports.
export async function runProviderOperation<T>(options: ProviderOperation<T>): Promise<T> {
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
      const response = await options.execute(requestSignal);

      status = response.status;
      result = response.value;
      requestSignal.throwIfAborted();
    } catch (cause) {
      if (cause instanceof ProviderError) status = cause.providerStatus;

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

    if (failure?.kind === "rate_limit") deferredUntil = retryTime(failure.retryAfter, Date.now());

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

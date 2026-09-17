import { ProviderError, runProviderOperation } from "./provider-operation";
import type { ResearchAttempt, ResearchRequestHooks } from "@radar/core/research";

export { ProviderError } from "./provider-operation";

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

// HTTP response handling belongs here; scheduling policy also supports SDK operations.
export function requestProvider<T>(options: ProviderRequest<T>): Promise<T> {
  return runProviderOperation({
    ...options,
    execute: async (signal) => {
      const response = await options.send(signal);
      const status = response.status;

      if (!response.ok) {
        await response.body?.cancel();
        throw new ProviderError(status === 429 ? "rate_limit" : "http", status, {
          retryAfter: response.headers.get("Retry-After"),
        });
      }

      try {
        const body: unknown = await response.json();

        signal.throwIfAborted();

        try {
          return { value: options.parse(body), status };
        } catch (cause) {
          if (cause instanceof ProviderError) throw cause;

          throw new ProviderError("invalid_response", status, { cause });
        }
      } catch (cause) {
        throw cause instanceof ProviderError
          ? new ProviderError(
              cause.kind,
              cause.status,
              { cause: cause.cause, providerStatus: status },
              cause.code,
            )
          : new ProviderError(
              cause instanceof SyntaxError ? "invalid_response" : "network",
              status,
              { cause },
            );
      }
    },
  });
}

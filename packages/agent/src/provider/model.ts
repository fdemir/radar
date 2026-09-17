import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

export type ModelConfig = {
  OPENAI_API_KEY: string;
  OPENAI_BASE_URL: string;
  OPENAI_MODEL: string;
};

export function createModel(config: ModelConfig, request: typeof fetch = fetch) {
  const provider = createOpenAICompatible({
    name: "radar",
    apiKey: config.OPENAI_API_KEY,
    baseURL: config.OPENAI_BASE_URL.replace(/\/$/, ""),
    // Our compatible endpoint guarantees JSON mode, not native JSON Schema support.
    supportsStructuredOutputs: false,
    fetch: (input, init) => request(input, { ...init, redirect: "manual" }),
    transformRequestBody: ({ max_tokens, ...body }) => ({
      ...body,
      ...(max_tokens === undefined ? {} : { max_completion_tokens: max_tokens }),
    }),
  });

  return provider(config.OPENAI_MODEL);
}

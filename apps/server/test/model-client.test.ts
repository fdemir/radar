import { afterEach, expect, it, vi } from "vitest";
import { composeTask, ComposeUnavailableError } from "../../../packages/agent/src/compose/index";
import { taskInputSchema } from "@radar/core";

const config = {
  OPENAI_API_KEY: "test-key",
  OPENAI_BASE_URL: "https://model.example.com/v1",
  OPENAI_MODEL: "test-model",
};
const task = taskInputSchema.parse({
  title: "Hono releases",
  brief: "Track stable releases",
  category: "Technology",
  status: "draft",
  frequency: "Daily",
  time: "09:00",
  language: "English",
  email: false,
  messages: [],
});

afterEach(() => vi.unstubAllGlobals());

it("uses JSON mode through the compatible SDK without automatic retries", async () => {
  const request = vi.fn<typeof fetch>(async () =>
    Response.json({
      choices: [
        {
          message: {
            role: "assistant",
            content: JSON.stringify({ ...task, reply: "Ready for review." }),
          },
          finish_reason: "stop",
        },
      ],
    }),
  );

  vi.stubGlobal("fetch", request);

  const result = await composeTask(config, task, "Track Hono");

  expect(result.messages.at(-1)?.text).toBe("Ready for review.");
  expect(request).toHaveBeenCalledOnce();

  const [url, init] = request.mock.calls[0]!;
  const body = JSON.parse(String(init?.body));

  expect(url).toBe("https://model.example.com/v1/chat/completions");
  expect(init?.redirect).toBe("manual");
  expect(body.response_format).toEqual({ type: "json_object" });
  expect(body.max_completion_tokens).toBe(4000);
  expect(body.max_tokens).toBeUndefined();
});

it("does not retry a compose outage or expose its response body", async () => {
  const request = vi.fn(async () => new Response("private provider details", { status: 503 }));

  vi.stubGlobal("fetch", request);
  await expect(composeTask(config, task, "Track Hono")).rejects.toBeInstanceOf(
    ComposeUnavailableError,
  );
  expect(request).toHaveBeenCalledOnce();
});

import type { TaskInput } from "@radar/core";
import { composeTask, type ComposeOptions } from "./compose";
import { createResearch } from "./research";
import { createResearchModel, type ModelConfig } from "./research-model";
import { createRetrieval } from "./retrieval";

export { ResearchError, ResearchCancelled } from "./research-state";

export type AgentConfig = ModelConfig & { TINYFISH_API_KEY: string };

export function createAgent(config: AgentConfig) {
  return {
    compose(task: TaskInput, message: string, options?: ComposeOptions) {
      return composeTask(config, task, message, options);
    },
    research: createResearch({
      model: createResearchModel(config),
      sources: (brief, signal, hooks) =>
        createRetrieval(config.TINYFISH_API_KEY, brief, signal, hooks),
    }),
  };
}

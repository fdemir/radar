import { createAgent, ResearchCancelled, ResearchError, type AgentConfig } from "@radar/agent";
import { createDb } from "@radar/db";
import { createResearch } from "@radar/db/research";
import { WorkspaceError } from "@radar/db/workspace";
import { createProviderBudget } from "@radar/db/provider-budget";
import { ResearchDeferred } from "@radar/core/research";
import type { ResearchJob } from "@radar/core/research";
import {
  createEmail,
  deliverEmail,
  createDiscord,
  deliverDiscord,
  type DiscordConfig,
  type EmailConfig,
} from "@radar/notifications";

type WorkerEnv = AgentConfig &
  EmailConfig &
  DiscordConfig & { DB: D1Database; RESEARCH_QUEUE: Queue<ResearchJob>; CORS_ORIGIN: string };

export default {
  async fetch() {
    return new Response("Not found", { status: 404 });
  },
  async scheduled(_controller: ScheduledController, env: WorkerEnv) {
    const research = createResearch(createDb(env));

    await research.expire();

    if (env.OPENAI_API_KEY && env.TINYFISH_API_KEY) {
      for (const task of (await research.due()).results) {
        try {
          await research.start(task.userId, task.id);
        } catch (error) {
          if (!(error instanceof WorkspaceError)) throw error;
        }
      }

      // Repairs the gap between a committed run and queue publishing.
      for (const run of await research.queued()) await env.RESEARCH_QUEUE.send({ runId: run.id });
    }

    await deliverDiscord(createDb(env), createDiscord(env), env.CORS_ORIGIN);
    await deliverEmail(createDb(env), createEmail(env), env.CORS_ORIGIN);
  },
  async queue(batch: MessageBatch<ResearchJob>, env: WorkerEnv) {
    const db = createDb(env);
    const research = createResearch(db);
    const budget = await createProviderBudget(db, env.TINYFISH_API_KEY);

    for (const message of batch.messages) {
      const claimed = await research.claim(message.body.runId);

      if (!claimed) {
        message.ack();
        continue;
      }

      try {
        const result = await createAgent(env).research(
          claimed.task,
          claimed.previous,
          (stage, sources) => research.progress(claimed.run.id, claimed.lease, stage, sources),
          {
            attempts: claimed.attempts,
            recordAttempt: (attempt) =>
              research.recordAttempt(claimed.run.id, claimed.lease, attempt),
            beforeAttempt: async () => {
              if (!(await research.active(claimed.run.id, claimed.lease)))
                throw new ResearchCancelled();
            },
            checkpoint: claimed.run.checkpoint,
            saveCheckpoint: (checkpoint) =>
              research.checkpoint(claimed.run.id, claimed.lease, checkpoint),
            reserve: (service, amount) => budget.reserve(service, amount),
            backoff: (service, retryAt) => budget.backoff(service, retryAt),
          },
        );

        await research.complete(claimed.run.id, claimed.lease, result);
      } catch (error) {
        if (error instanceof ResearchDeferred) {
          await research.defer(claimed.run.id, claimed.lease, error.retryAt);
        } else if (!(error instanceof ResearchCancelled)) {
          await research.fail(
            claimed.run.id,
            claimed.lease,
            error instanceof ResearchError
              ? error.message
              : "Research could not finish. Try again.",
          );
        }
      }

      message.ack();
    }

    await deliverDiscord(createDb(env), createDiscord(env), env.CORS_ORIGIN);
    await deliverEmail(createDb(env), createEmail(env), env.CORS_ORIGIN);
  },
} satisfies ExportedHandler<WorkerEnv, ResearchJob>;

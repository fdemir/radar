# Radar — technical reference

Read this document when setting up local development, changing research or scheduling behavior, working on shared UI, running checks, or deploying Radar. For a product overview, see [README.md](README.md).

Built with React Router, Hono, Better Auth, Drizzle, Cloudflare D1 and Workers, AI SDK, TinyFish, and an OpenAI-compatible model. The monorepo uses pnpm, Turborepo, Alchemy, and Oxlint.

## Local setup

Use Node.js 22.15 or later and pnpm 10.

```sh
pnpm install
cp apps/server/.env.example apps/server/.env
cp apps/web/.env.example apps/web/.env
pnpm dev:local
```

Open [localhost:5174](http://localhost:5174). The API runs on port 3000. Local accounts, tasks, queues, and the auth secret persist in the ignored `.cache/local` folder. Migrations run automatically. No Cloudflare account is needed for local development.

Add these values to `apps/server/.env` to enable research:

| Variable           | Purpose                               |
| ------------------ | ------------------------------------- |
| `OPENAI_API_KEY`   | Model provider key                    |
| `OPENAI_BASE_URL`  | Compatible API URL, including `/v1`   |
| `OPENAI_MODEL`     | Model available through your provider |
| `TINYFISH_API_KEY` | TinyFish Search and Fetch key         |

The model must support Chat Completions with JSON responses. The default is `gpt-5.6-luna`; change it if your provider uses another model name.

Email is optional. Set `RESEND_API_KEY` and `EMAIL_FROM` to a sender verified in Resend, then restart. Without them, research works but email delivery, verification, and password recovery stay unavailable. Verify your account email in Settings before receiving findings. Restart the local API after changing environment values.

Task notification channels follow account preferences in Settings. The legacy task `email` field remains for stored-data compatibility and does not control delivery.

## Task lifecycle

- Sign up and sign in with a username and password.
- Create a task through chat or edit its details directly. Drafts do not run.
- Activate a task to run its first check. Pause, resume, edit, or delete it from the task screen.
- Check hourly, daily, every three days, or weekly in your chosen timezone. Local schedules run while `pnpm dev:local` is running; deployed schedules run without an open browser.
- Read findings, save them, and inspect run history and sources. The landing page contains clearly marked sample findings; account workspaces use the database.
- Receive one email summary when a run adds findings. Duplicate event/version pairs do not create another finding or email.

### Research and evidence

Research uses an explicit bounded tool loop. AI SDK handles model requests, streaming, and tool-call parsing; the runner owns cancellation and checkpoints. Model decisions and tool results pass through typed state transitions, while source validation is a pure operation. Checkpoints use version 3 and migrate both version 2 and the earlier fixed-pipeline format when a queued run resumes across deployment. The model sees search titles and snippets, reads primary sources, and can make 1–2 targeted follow-up searches. It can also read a known public source directly: requiring its exact URL to appear in search results prevented valid repositories from being checked. Repeated reads are skipped. The budget allows supporting release or license pages alongside the requested matches, and the final model turn summarizes available evidence. Search filters follow the brief; a daily schedule does not restrict an open listing to items posted today.

Search snippets and proposed URLs are leads, not verified findings. Model output must cite a page the run actually read. Optional source excerpts are checked against the page text before saving. An unverifiable quote is omitted and coverage marked limited, without discarding the finding from its successfully read source; unread-source citations are still rejected. Quote validation does not start another model turn: feedback about rejected quotes leaked into user-facing summaries during live validation. Long page excerpts preserve the beginning and end, with an explicit omission marker, so footer license and adoption information is not silently lost. Missing optional details do not disqualify a match. Relevant sources with no new events do not trigger extra research. Incomplete research is labeled separately from no new matches. Finding cards and details offer an expandable Source excerpt; older findings remain readable without one. The scheduler recovers stuck work after ten minutes. Three consecutive failures pause the task. Tool decisions and individual completed calls are checkpointed, so a rate-limited batch resumes at the pending call without repeating its successful requests.

### Account limits and cancellation

Each account can have five active tasks and thirty checks per UTC day. Manual checks have a ten-second cooldown. Editing or pausing a task cancels its old work and pending mail. A provider request that has already started may still finish. Delivery retries use a stable Resend idempotency key. Each mail claim atomically checks its retry time and carries a unique lease so stale workers cannot overwrite a newer attempt. The first attempt is retained across retries. Resend deduplicates for 24 hours; Radar stops automatic retries one minute before that window ends. Expired ambiguous sends, exhausted abandoned claims, and previously attempted legacy rows without a first-attempt timestamp become `uncertain` and require operator review in Resend before any resend. Inspect them with `SELECT id, run_id, target, attempts, first_attempt_at FROM delivery WHERE status = 'uncertain'`. Unattempted mail can still send even after a long backlog.

### Provider limits and recovery

All users sharing a TinyFish key share a durable provider budget: Search allows 30 requests per rolling minute and 500 per rolling hour; Fetch allows 150 URLs per rolling minute and 1,000 per rolling day. Requests, including retries, reserve capacity atomically before calling the provider. TinyFish and research-model HTTP 429 responses put the existing check into a visible waiting state, honor Retry-After (60 seconds when absent or invalid), and resume automatically through the scheduler without spending another daily check or increasing the failure count. TinyFish backoff is shared across tasks using the same key; model backoff applies to the affected run. Completed research steps are checkpointed, so waiting before page reading or a model decision does not repeat successful searches or reads. Rate-limit waiting has no attempt-count cap. Temporary page content is removed when a run completes, fails, or is cancelled.

Research provider requests share the transport-independent retry policy in `packages/agent/src/provider-operation.ts`. TinyFish HTTP handling lives in `provider-request.ts`; model requests use the AI SDK adapter with SDK retries disabled so every retry is accounted for. The policy is: network errors and HTTP 500/502/503/504 allow at most two retries, after 1 and 3 seconds; timeouts allow one retry within that same maximum. Retries require enough time for another full request within the current worker execution's five-minute research budget. The worker checks the task's lease and active status before each attempt. Retry counts survive quota deferrals. HTTP 400/401/403/404, malformed responses, empty content, and source access restrictions are not retried. TinyFish can return HTTP 200 with per-URL failures in `errors`; their codes and upstream HTTP status determine the retry decision. See the [Fetch API contract](https://agent.tinyfish.ai/v1/openapi/fetch). An incomplete result with zero readable sources still ends the check; there is no automatic second research pass.

The `research_attempt` table retains one diagnostic record per finished provider attempt, linked to its run: operation, service, query or URL, attempt number, start time, duration, provider HTTP status, source HTTP status, classified error, provider error code, and planned retry time. Diagnostics survive checkpoint cleanup and are deleted with their run/task. Request headers, model prompts, page bodies, and raw exception messages are excluded; credential-like URL parameters are redacted. For a failed check, inspect its records with `SELECT * FROM research_attempt WHERE run_id = ? ORDER BY started, attempt`. Historical checks created before this migration have no attempt diagnostics. Provider-call outcomes are distinct from final finding eligibility or quote validation.

### Discord

Discord can be connected from Settings using a personal **User Install**, with no server installation step. It links an existing Radar account; it does not add Discord sign-in. A welcome DM checks delivery before research notifications become active. New findings from all active tasks are sent independently of email preferences. Settings provides a notification switch, test message, and disconnect; successful finding DMs also appear in Notifications.

Discord can refuse unsolicited DMs without a mutual server (`50278`), or due to privacy settings/blocking (`50007`). User Install and account linking do **not** guarantee delivery for every account. Radar shows the linked-but-blocked state and does not activate notifications on a failed welcome. No automatic guild join or guild installation is performed.

Live validation on 2026-09-17 confirmed the local web OAuth flow, welcome DM, explicit test DM, and a background finding DM with the bot installed in **zero guilds**. Discord displayed “No servers in common.” The finding was explicitly labeled synthetic, created through the production research completion function, and sent by the scheduled worker after a process restart using only the bot token. All three deliveries were recorded as sent on their first attempt. The synthetic task was paused afterward. This validates the local integration. Production was deployed on 2026-09-17 with the production OAuth callback registered; the live Settings page exposes an enabled Connect to Discord button. A production account connection and a separate long-delay delivery test remain to be verified.

### Discord setup

1. Create an application named Radar at <https://discord.com/developers/applications>.
2. In Installation, enable **User Install** and disable **Guild Install**. Set the user install scope to `applications.commands`. No privileged intents or interaction endpoint are needed for this web-based connection flow.
3. In OAuth2, register the callback URL used by the API. For the default local setup: `http://localhost:3000/api/discord/callback`. For production: `https://radar-api.fdemir.dev/api/discord/callback`.
4. Set `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_BOT_TOKEN` and `DISCORD_REDIRECT_URI` in the ignored `apps/server/.env` (or deployment environment). Restart the local API. Keep the redirect value identical to the one registered in Discord. An isolated worktree on API port 3002 uses `http://localhost:3002/api/discord/callback` instead.
5. Sign into Radar, open Settings, choose **Connect to Discord**, authorize, and check both the status in Radar and the welcome DM. Repeat with an account that shares no server with the bot and verify a new finding DM after at least 15 minutes. A failed DM is a failed feasibility check, not a successful notification setup.

Connection requests are bound to the signed-in Radar session with a hashed, single-use, ten-minute state. OAuth access tokens are discarded after the identity lookup. Each Discord identity can link to only one Radar account. Disconnect invalidates outstanding connection attempts and removes pending delivery records. Task edits/pauses and turning notifications off cancel pending findings. A provider request already in flight may still finish.

DM sends use durable delivery records and short-term Discord nonce deduplication. Rate limits honor the provider's retry delay across requests; channel-opening failures can retry. Message POST timeouts, server errors, or abandoned sends are treated as uncertain and require an explicit test to restore delivery, since Discord does not offer durable idempotency. Radar avoids automatic resends that could duplicate an already-delivered message.

## Project layout

| Path                     | Responsibility                                                  |
| ------------------------ | --------------------------------------------------------------- |
| `apps/web`               | Letters UI and public examples                                  |
| `apps/server`            | Hono API, authentication, task ownership                        |
| `apps/worker`            | Scheduled checks, queue consumption, email delivery             |
| `packages/agent`         | Bounded research runner, TinyFish, AI SDK model calls           |
| `packages/core`          | Shared validation and schedule rules                            |
| `packages/db`            | D1 schema, migrations, queries, atomic finding delivery records |
| `packages/auth`          | Better Auth configuration                                       |
| `packages/notifications` | Resend and Discord delivery adapters                            |
| `packages/ui`            | Shared components and styles                                    |
| `packages/infra`         | Alchemy Cloudflare resources                                    |

## UI components

Shared UI components live in `packages/ui`. From the repository root, add components with `pnpm --filter @radar/ui exec shadcn add <component> -c ../../apps/web`. Preview changes with `--dry-run`; review before overwriting a customized component. Keep both `components.json` files on the same style and base library.

Use shadcn components for controls and Tailwind utilities for layout. Keep theme tokens in `packages/ui/src/styles/globals.css`. For links styled as buttons, use `buttonVariants` on `Link` or `a` so they retain their link semantics. See the [shadcn monorepo guide](https://ui.shadcn.com/docs/monorepo) and [button documentation](https://ui.shadcn.com/docs/components/base/button#as-link).

## Checks

Use `pnpm format` to format the code and `pnpm format:check` to check it without changing files.
`pnpm lint` runs the format check before Oxlint. `pnpm lint:fix` fixes lint issues and formats the code.
All packages share the root Prettier settings: two spaces, double quotes, semicolons, and a 100-character print width.
Generated files, database migrations, the lockfile, and ignored files are excluded.
Oxlint also requires blank lines around control flow, functions, and separate declaration blocks.

```sh
pnpm lint
pnpm check-types
pnpm test
pnpm build
```

Tests use isolated local D1 databases and the Workers runtime. Provider responses are controlled in integration tests; tests do not send real emails or require service keys.

Generate migrations after changing the database schema with `pnpm db:generate`. Environment schemas are checked in; generated accessors can be refreshed with `pnpm env:generate`. Keep keys in ignored environment files.

## Cloudflare deployment

Configure your Cloudflare profile with `cd packages/infra && pnpm exec alchemy profile edit`. Keep production settings in the ignored `packages/infra/.env.production.local` file, separate from local development. Set `NODE_ENV=production`, a separate persistent `BETTER_AUTH_SECRET` of at least 32 characters, and the service values above.

The web worker is named `radar-<stage>`. Production uses `radar.fdemir.dev` for the web app and `radar-api.fdemir.dev` for the API. Set `CORS_ORIGIN=https://radar.fdemir.dev`. The `fdemir.dev` zone must be active in the Cloudflare account. Alchemy manages both custom domains and their HTTPS certificates.

```sh
cd packages/infra
pnpm exec alchemy deploy --stage production --env-file .env.production.local
```

Alchemy provisions D1, applies migrations, and creates the API, web app, research worker, queue consumer, and a one-minute scheduler. Its first deployment also creates a shared state store in the Cloudflare account. Local accounts and tasks are not copied to production. The web app and API share the `fdemir.dev` site so sign-in cookies work without third-party cookies.

Deployments copy the SQL files listed in the Drizzle journal into an ignored `.alchemy/migrations` folder. Alchemy applies these unchanged files and tracks production migrations. Keep generating schema changes with `pnpm db:generate`.

Cloud deployment must be verified with your Cloudflare account. Local checks do not verify cloud credentials, domains, provider quotas, or live email delivery.

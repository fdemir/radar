# Radar

Describe what to follow. Radar checks the web on a schedule and saves new findings with source links.

Built with React Router, Hono, Better Auth, Drizzle, Cloudflare D1 and Workers, LangGraph, TinyFish, and an OpenAI-compatible model. The monorepo uses pnpm, Turborepo, Alchemy, and Oxlint.

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

## Behavior

- Sign up and sign in with a username and password.
- Create a task through chat or edit its details directly. Drafts do not run.
- Activate a task to run its first check. Pause, resume, edit, or delete it from the task screen.
- Check hourly, daily, every three days, or weekly in your chosen timezone. Local schedules run while `pnpm dev:local` is running; deployed schedules run without an open browser.
- Read findings, save them, and inspect run history and sources. The landing page contains clearly marked sample findings; account workspaces use the database.
- Receive one email summary when a run adds findings. Duplicate event/version pairs do not create another finding or email.

Research uses at most five search queries, five pages, and five findings per run. If the first searches are empty, it can broaden the queries within the same budget. Model output must cite a page the run actually read. Each run has a three-minute research deadline; the scheduler recovers stuck work after ten minutes. Three consecutive failures pause the task.

Each account can have five active tasks and thirty checks per UTC day. Manual checks have a ten-second cooldown. Editing or pausing a task cancels its old work and pending mail. A provider request that has already started may still finish. Delivery retries use a stable Resend idempotency key.

Discord can be connected from Settings using a personal **User Install**, with no server installation step. It links an existing Radar account; it does not add Discord sign-in. A welcome DM checks delivery before research notifications become active. New findings from all active tasks are sent independently of email preferences. Settings provides a notification switch, test message, and disconnect; successful finding DMs also appear in Notifications.

Discord can refuse unsolicited DMs without a mutual server (`50278`), or due to privacy settings/blocking (`50007`). User Install and account linking do **not** guarantee proactive DM access. Radar shows the linked-but-blocked state and does not activate notifications on a failed welcome. The serverless delivery scenario must be tested with a real Discord account before promising it to users. No automatic guild join or guild installation is performed.

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
| `packages/agent`         | LangGraph research, TinyFish, model calls                       |
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

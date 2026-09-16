# radar

This project was created with [Better-T-Stack](https://github.com/AmanVarshney01/create-better-t-stack), a modern TypeScript stack that combines React, React Router, Hono, and more.

## Features

- **TypeScript** - For type safety and improved developer experience
- **React Router** - Declarative routing for React
- **TailwindCSS** - Utility-first CSS for rapid UI development
- **Shared UI package** - shadcn/ui primitives live in `packages/ui`
- **Hono** - Lightweight, performant server framework
- **workers** - Runtime environment
- **Drizzle** - TypeScript-first ORM
- **Cloudflare D1** - Database engine
- **Authentication** - Better-Auth
- **Turborepo** - Optimized monorepo build system

## Getting Started

First, install the dependencies:

```bash
pnpm install
```

## Database Setup

This project uses Cloudflare D1 (SQLite) with Drizzle ORM.

Runtime database access uses the Cloudflare `DB` binding from `packages/infra/alchemy.run.ts`. If a local `DATABASE_URL` is present, it is only for database tooling.

Alchemy provisions the D1 database and applies migrations during `deploy`.

1. Generate migration files:

```bash
pnpm run db:generate
```

Start the local app without cloud credentials:

```bash
pnpm dev:local
```

Open [http://localhost:5174](http://localhost:5174). The local API runs on port 3000. Migrations run automatically; accounts and the auth secret persist in the ignored `.cache/local` directory. `pnpm dev` remains available for Alchemy development.

## Workspace

The app uses the Letters design: white surfaces, a sky gradient hero, near-black pill buttons, and small blue icon accents. Screens include tasks, conversational setup and editing, findings, run history, notifications, and account settings.

Authentication uses the real local API. Research, schedules, email verification and Discord linking/delivery are simulated; no searches or messages are sent. Task data and preferences persist per account in this browser. Use a task’s **Sample outcome** control to try new findings, no matches, and failures. Three consecutive failures pause a task; repeated sources do not create duplicate findings or notifications. **Sample data** in the footer restores the initial workspace.

Display names and notification preferences are sample workspace data; they do not modify login credentials.

## Authentication

Registration requires a username, email, and password. Sign-in uses the username and password; usernames are case-insensitive. Workspace routes require a session. Live email verification, password recovery, and Discord account linking are not implemented yet. Email verification and Discord linking have sample UI flows.

Apply the checked-in migration before using auth. HTTPS uses secure, HTTP-only cookies; local HTTP development uses SameSite=Lax cookies. Deploy the web and API on the same site (for example, `app.example.com` and `api.example.com`) to avoid third-party cookie restrictions. `CORS_ORIGIN` must match the web origin exactly.

Run the auth integration tests against an isolated local D1 database, without a Cloudflare account:

```bash
pnpm test
pnpm check-types
pnpm build
```

## UI Customization

React web apps in this stack share shadcn/ui primitives through `packages/ui`.

- Change design tokens and global styles in `packages/ui/src/styles/globals.css`
- Update shared primitives in `packages/ui/src/components/*`
- Adjust shadcn aliases or style config in `packages/ui/components.json` and `apps/web/components.json`

### Add more shared components

Run this from the project root to add more primitives to the shared UI package:

```bash
npx shadcn@latest add accordion dialog popover sheet table -c packages/ui
```

Import shared components like this:

```tsx
import { Button } from "@radar/ui/components/button";
```

### Add app-specific blocks

If you want to add app-specific blocks instead of shared primitives, run the shadcn CLI from `apps/web`.

## Environment Configuration

Each app owns its environment schema in `.env.schema`. Varlock generates `src/env.ts` during installation; run `pnpm run env:generate` after changing a schema. Commit schemas, and keep secrets in ignored env files or your deployment platform.

Import the generated `ENV` accessor in application code. Shared database and auth packages receive configuration or initialized clients from the application. See [Varlock's monorepo guide](https://varlock.dev/guides/monorepos/).

For Cloudflare, Alchemy loads and validates deployment inputs with `varlock/auto-load` in its Node/Bun deployment process. Worker code reads native bindings; web clients use the framework's public env API through `src/env.public.ts` where needed. Alchemy supplies resource URLs and managed database credentials. In-Worker Varlock protections are deferred until an official Alchemy integration is available; see [the non-Wrangler deployment guidance](https://varlock.dev/integrations/cloudflare/#non-wrangler-deploy-tools-alchemy-sst-pulumi).

Bun's automatic env loading is disabled in `bunfig.toml`; the framework integration or server bootstrap loads Varlock. Node deployments must include Varlock and its dependencies alongside the app schema.

## Deployment

### Alchemy

- Target: web on Cloudflare + server on Cloudflare
- Configure provider accounts: `cd packages/infra && pnpm exec alchemy profile edit`
- Dev: pnpm run dev
- Deploy: pnpm run deploy
- Destroy: pnpm run destroy

`alchemy profile edit` stores the selected Axiom, Cloudflare, Neon, PlanetScale, and/or Prisma provider profiles under `~/.alchemy`; no provider-specific setup command is required by this scaffold.

Deploys are staged and default to a personal `dev_<username>` stage. For production, run the deploy with an explicit stage from `packages/infra`:

```bash
cd packages/infra && pnpm exec alchemy deploy --stage production
```

### Production origins

- Required after the first deploy: set `CORS_ORIGIN` in `apps/server/.env` to the exact deployed web origin, such as `https://app.example.com`, then deploy the server again.

## Project Structure

```
radar/
├── apps/
│   ├── web/         # Frontend application (React + React Router)
│   └── server/      # Backend API (Hono)
├── packages/
│   ├── ui/          # Shared shadcn/ui components and styles
│   ├── auth/        # Authentication configuration & logic
│   └── db/          # Database schema & queries
```

## Available Scripts

- `pnpm dev:local`: Start the web app and persistent local API without cloud credentials
- `pnpm run dev`: Start applications through Alchemy
- `pnpm run build`: Build all applications
- `pnpm run dev:web`: Start only the web application
- `pnpm run dev:server`: Start only the server
- `pnpm run check-types`: Check TypeScript types across all apps
- `pnpm run db:generate`: Generate database client/types

## Linting

Run `pnpm lint` to check all apps and packages with Oxlint (TypeScript and React rules). Run `pnpm lint:fix` to apply safe fixes. Generated files and build outputs are excluded.

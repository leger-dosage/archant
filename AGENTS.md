# Archant — Agent Guide

Self-hosted personal finance for one household. Bank data comes from Enable Banking (PSD2), stays in your own database, and never leaves your infrastructure.

## Quick Setup

```bash
pnpm install --frozen-lockfile
cp .env.example .env
pnpm db migrate:local
pnpm api start:dev     # Hono worker on http://localhost:8787
pnpm web start:dev     # Vite dev server on http://localhost:5173
```

## Verification Gate

GitHub Actions runs the same checks on every pull request, but run them locally first — a red pipeline on a public repo is a bad first impression for contributors.

```bash
pnpm install --frozen-lockfile
pnpm format
pnpm lint:code
pnpm lint:format
pnpm typecheck
pnpm test
```

Do not modify tracked files after this sequence. Never add `--if-present` to the root scripts: a package without a script is a packaging mistake that must fail loudly, not be skipped silently.

## How to write in this file

This file describes the **current** state of the conventions, never a historical narrative. A durable convention change edits the convention in place. Architectural narrative belongs in an ADR under `docs/adr/`. Per-story narrative belongs in commit messages and `_bmad-output/implementation-artifacts/`.

## Project

Archant re-implements, one at a time, the features of [Sure](https://github.com/we-promise/sure) that matter for a single household, on a stack that fits a generous free tier. Features are cherry-picked deliberately: each one is scoped through BMAD before any code is written.

Non-goals: multi-tenancy beyond one household, a managed SaaS offering, server-side rendering, search engine optimisation.

## Monorepo structure

| Package        | Role                                                       | Runtime           |
| -------------- | ---------------------------------------------------------- | ----------------- |
| `@archant/web` | Vite + React SPA (interface)                               | Browser           |
| `@archant/api` | Hono server (REST + scheduled sync)                        | Any Fetch runtime |
| `@archant/db`  | Drizzle schema and derived types, shared by the two others | —                 |

`@archant/api` is written against web standards only, so the same code runs on Cloudflare Workers, Node, Bun and Deno. Anything runtime-specific lives in an entrypoint under `packages/api/src/entrypoints/`, never in a route or a service.

## Key conventions

- **File names are kebab-case** (`lib/exchange-rate.ts`, `routes/transactions.ts`). React components are PascalCase (`TransactionRow.tsx`), hooks are camelCase (`useAccounts.ts`).
- **No barrel files.** Direct imports only. The single `index.ts` allowed is a runtime entrypoint.
- **Tests are co-located** and named `*.spec.ts(x)`: `exchange-rate.ts` sits next to `exchange-rate.spec.ts`.
- **Why-comments.** Comment the reason, never the mechanism. A non-obvious configuration line carries the incident that produced it. This is the strongest stylistic signature of these repositories.
- **Comments and documentation are in English**, including commit messages.
- **Money is never a float.** Amounts are integer minor units plus an ISO 4217 currency code. A bare `number` in a function signature that means money is a bug.

## Environment variables

Validated with `@t3-oss/env-core` and Zod, never read through a bare `process.env`. The server exports a `validateEnv(runtimeEnv)` function rather than a module-level object, because Workers have no ambient `process.env` and bindings arrive per request.

`.env.example` is the contract: every variable is listed there, with a comment saying what degrades when it is absent.

## Database

SQLite everywhere, through Drizzle. Local development and self-hosting use a file; hosted deployments use Turso or Cloudflare D1. The dialect never changes, so a single schema and a single set of migrations cover all three.

Columns are snake_case, mapped to camelCase in TypeScript (`transactedAt: integer("transacted_at")`). Derived types come from `InferSelectModel` / `InferInsertModel` in `packages/db/types.ts`. Never write raw SQL in application code.

## API contract

Success is `{ "data": ... }`, failure is `{ "error": { "code": "...", "message": "..." } }`. Codes are a closed union in SCREAMING_SNAKE_CASE, declared in `packages/api/src/lib/errors.ts` as an `AppError` class. A single `app.onError` maps `AppError` to its JSON and anything else to a generic `INTERNAL_ERROR` 500, so an unexpected throw never leaks a stack trace or a provider payload.

Error messages returned by the API are in English. The interface translates them from the code.

## Security

This application holds bank transactions. The bar is higher than the usual side project.

- Every input crossing a boundary is parsed by a Zod schema, including provider responses. A provider is not trusted just because it is a bank.
- Provider tokens and refresh tokens are encrypted at rest, never logged, never returned by an endpoint.
- Sessions are managed by Better Auth. Do not hand-roll session handling, and do not weaken its defaults.
- No secret is ever committed. `.env` is ignored; `.env.example` holds names and comments only.
- Logs and error reports must never contain an amount tied to an identity, an IBAN, or an access token.
- Dependencies stay few and popular. A new dependency needs a reason in the pull request description.

## Testing

Vitest for unit and integration tests, Playwright for end-to-end. Coverage is expected to be high but stays pragmatic: the money paths (import, deduplication, balance computation, currency conversion, provider sync) are covered to the branch; wiring and presentational components are not padded with tests that assert nothing.

No test reaches the network. An unmocked request fails the test that sent it, naming the URL.

## Deployment

The primary target is a single Cloudflare Worker serving both the static assets and the API, with Turso or D1 behind it. A `Dockerfile` covers self-hosting with a plain SQLite file. Each target is one entrypoint plus one configuration file; adding a target must never fork the application code.

Scheduled synchronisation is a protected `POST /api/sync` route. Every platform triggers it its own way — a Cloudflare cron trigger, a GitHub Action, a system cron — and the route does not care which.

## Planning with BMAD

Planning artifacts live in `_bmad-output/planning-artifacts/`, implementation artifacts in `_bmad-output/implementation-artifacts/`, and long-lived project knowledge in `docs/`. Agents speak French in chat; every document they produce is written in English.

# 0001 — Technology stack

- Status: Accepted
- Date: 2026-09-16

## Context

Archant re-implements the useful parts of Sure, a Rails application, for a single household. Sure needs PostgreSQL, Redis and a Sidekiq worker process, which costs roughly 35 to 50 USD a month on a managed cloud and cannot run on a free tier. Its architecture is sized for a multi-tenant hosted product; a household does not need that.

Three constraints drive every choice below.

1. The project must deploy on a generous free tier, primarily Cloudflare, without forking the application code per platform.
2. It must stay easy to self-host: one container, one file-backed database, no broker and no separate worker process.
3. It is a public repository, so contributors must recognise the tools.

## Decision

| Concern        | Choice                  | Why                                                                                                                         |
| -------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Language       | TypeScript 7            | Native Go compiler since July 2026, roughly ten times faster type-checking on the same code                                 |
| Server         | Hono                    | Built on web standards, so one codebase runs on Workers, Node, Bun and Deno with a six-line entrypoint per target           |
| Interface      | Vite + React            | No SEO requirement, so no server rendering; React over Svelte because contributors are seventy times more likely to know it |
| Routing        | TanStack Router         | Fully typed routes and search params, the recommended choice for a dashboard-shaped SPA                                     |
| Server state   | TanStack Query          | Already the standard in the sibling projects                                                                                |
| Database       | SQLite, via Drizzle ORM | One dialect covers a local file, Turso and Cloudflare D1, so schema and migrations never fork                               |
| Authentication | Better Auth             | A library inside the process, not a service to deploy; no per-user cost, data stays in our database                         |
| Bank data      | Enable Banking          | The only PSD2 aggregator that a private individual can use for their own accounts at no cost, verified against BoursoBank   |
| Tests          | Vitest and Playwright   | Vitest shares the Vite pipeline; Playwright covers the money paths end to end                                               |
| Packaging      | pnpm workspaces         | Same as the sibling projects, three packages                                                                                |

## Alternatives considered

**PostgreSQL over SQLite.** Rejected: it forces a managed database on every deployment, around 16 USD a month on the cheapest managed option, for a dataset a household will never grow past a few hundred megabytes. SQLite with FTS5 covers full-text search, which was the main functional argument for Postgres.

**Next.js.** Rejected: its value is server rendering and SEO, neither of which applies, and it needs an adapter on Cloudflare.

**Convex or Supabase.** Both were considered as all-in-one backends. Rejected: they bind the project to one vendor, which contradicts the "deploy anywhere" constraint. Supabase additionally does not host a frontend, and pauses free projects after a week of inactivity.

**Cloudflare D1 as the only database.** Rejected as the sole target: since 1 September 2026 the free plan hard-fails queries past its daily row limits, and a file-backed SQLite must stay possible for self-hosting. D1 remains a supported target, not the assumption.

**Elysia instead of Hono.** Rejected: it depends on Bun-specific APIs, which would defeat the portability requirement.

**Prisma instead of Drizzle.** Rejected: its Rust query engine adds roughly 200 ms of cold start on serverless runtimes, and Drizzle has the better SQLite and Turso support.

**A hand-rolled session layer.** Rejected: authentication is where projects of this shape introduce vulnerabilities, and this one holds bank transactions. Lucia, the usual lightweight answer, has been deprecated since March 2025.

## Consequences

- The SQLite dialect is the decision that is hardest to undo. Anything the schema needs must be expressible in SQLite.
- Background work has no queue. Long jobs run inside the request that triggers the sync route, which is acceptable for one household and would not be for a hosted product.
- Every new deployment target costs one entrypoint and one configuration file, and must never leak into application code.
- TypeScript 7 rules out ESLint, since `typescript-eslint` cannot run on it. Linting is done by Oxlint, whose type-aware engine is built on the same Go compiler. This is a deliberate divergence from the sibling projects, which are on ESLint. See [../tech-stack.md](../tech-stack.md) for the comparison and the two rules that did not map over.

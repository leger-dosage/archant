---
id: SPEC-monorepo-scaffolding
status: abandoned
companions:
  - package-layout.md
  - ../../../AGENTS.md
  - ../../../docs/tech-stack.md
sources: []
---

> **Abandoned on 2026-09-18. Do not implement.** Building the whole skeleton ahead of any feature produced code no feature used. Packages and dependencies now arrive with the first feature that needs them. What the attempt taught is in `_bmad-output/implementation-artifacts/scaffolding-lessons.md`.

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability — consult them only if you need narrative rationale or prose color this contract intentionally omits.

# Initial monorepo scaffolding

## Why

A vision to realize, blocked by a concrete gap. The repository carries conventions, a licence, a decision record and a stack inventory, but nothing that executes: `packages/` does not exist, so `pnpm lint:code` aborts with "No files found to lint" and no other gate can run either. Every feature cherry-picked from Sure lands on this skeleton, so its shape decides how each of them is written. Until it exists, neither a contributor nor an implementing agent can verify anything.

## Capabilities

- **CAP-1**
  - **intent:** A developer can install and start the project locally and reach a running API.
  - **success:** `pnpm install` followed by `pnpm api start:dev` answers `GET /health` with `200` and a `{"data":{"status":"ok"}}` body.
- **CAP-2**
  - **intent:** The verification gate runs end to end on a clean checkout.
  - **success:** `pnpm lint:code`, `pnpm lint:format`, `pnpm typecheck`, `pnpm test` and `pnpm test:e2e` all exit 0.
- **CAP-3**
  - **intent:** The data schema is shared across packages and migratable.
  - **success:** `drizzle-kit` generates a migration, `pnpm db migrate:local` applies it to a local SQLite file, and derived types import from `@archant/db`.
- **CAP-4**
  - **intent:** The API validates its environment and fails predictably.
  - **success:** A missing required variable aborts startup naming that variable; an unknown route returns `404` with an `{"error":{"code":"NOT_FOUND"}}` body.
- **CAP-5**
  - **intent:** The interface calls the API through a client typed from the route definitions.
  - **success:** Renaming a route in `@archant/api` makes `pnpm typecheck` fail inside `@archant/web`.
- **CAP-7**
  - **intent:** CI runs the same gate on every pull request.
  - **success:** The GitHub workflow triggers on `pull_request` and fails when any of the five commands fails.
- **CAP-8**
  - **intent:** A contributor can run the whole stack locally with Docker alone.
  - **success:** `docker compose up` serves the interface and the API against a SQLite file on a volume, with no cloud account and no external service.

<!-- CAP-6 (deploy to Cloudflare and to a container) was retired: the acceptance target is the container. Its id is never reused. -->

## Constraints

- The API is a plain Node.js project with a single entrypoint, `src/index.ts`. No platform-specific code path exists in this scope.
- Portability is a configuration concern, never a code concern. Running elsewhere is achieved through configuration and documentation, not through branches in application code.
- One SQLite dialect everywhere: the driver changes per target, the schema and migrations never fork.
- The local database is a plain SQLite file through `@libsql/client`, so a fresh clone needs no external account.
- Business logic never imports Hono and never touches the request context. It takes data and returns data.
- No barrel files, direct imports only. The one `index.ts` allowed is the runtime entrypoint.
- Tests are co-located and named `*.spec.ts(x)`. No test reaches the network.
- Warnings fail the lint gate: `oxlint` runs with `--max-warnings 0`.

## Non-goals

- Any business feature from Sure: accounts, transactions, budgets, rules, Enable Banking sync.
- Wiring Better Auth. It is in the stack inventory; connecting it is a later story.
- Choosing a CSS framework or a design system. The interface ships unstyled.
- Any platform-specific deployment configuration, Cloudflare included. Deployment targets are documented in `docs/deployment.md`, not scaffolded here.
- Internationalisation.

## Success signal

A contributor clones the repository on a machine that has only Node and pnpm, runs the commands in the README, and within ten minutes has the API answering and the five gate commands green — without reading anything beyond the README. The same contributor, with only Docker installed, gets there with `docker compose up`.

## Assumptions

- Better Auth is installed as a dependency but left unwired, so its tables do not appear in the initial schema.
- The interface ships unstyled; no styling decision is implied by this scope.

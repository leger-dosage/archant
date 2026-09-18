# Tech stack

Versions verified on 16 September 2026. The rationale behind each choice is in [adr/0001-technology-stack.md](adr/0001-technology-stack.md); this page is the inventory.

Only the toolchain is installed today. The package tables list what each package will use; a dependency is installed by the first feature that needs it, and one that no feature needs leaves the list.

## Toolchain

| Tool       | Version | Note                                     |
| ---------- | ------- | ---------------------------------------- |
| Node.js    | 24      | Pinned in CI, not in `engines`           |
| pnpm       | 10.28.2 | Pinned by `packageManager`               |
| TypeScript | 7.0.2   | Native Go compiler                       |
| Oxlint     | 1.83.x  | Type-aware linting via `oxlint-tsgolint` |
| Oxfmt      | 0.68.x  | Formatting and import sorting, tabs only |

### Why Oxlint rather than ESLint

ESLint is not usable here. TypeScript 7 ships no stable programmatic compiler API, so `typescript-eslint` refuses to run against it: with `typescript@7` installed, `pnpm exec eslint` aborts before it even loads the config. Upstream closed the TypeScript 7 request as not planned and targets 7.1. The same blocker hits `ts-jest`, `ts-morph`, and the template checkers behind Vue, Svelte and Astro.

The alternative was to install TypeScript 6 side by side through npm aliases, which works but leaves two compilers in the repository and a footnote for every contributor.

Oxlint removes the problem instead of working around it. Its type-aware engine, `oxlint-tsgolint`, is built on typescript-go — the same Go port that ships as TypeScript 7 — so it inherits the compiler rather than fighting it. It reached stable v7, is compatible with TypeScript 7.0.2, and covers 59 of the 61 type-aware rules of `typescript-eslint`.

Biome was the other candidate. It also sidesteps the TypeScript 7 problem, since it has its own inference engine and never loads the compiler, but that engine only approximates type information: on unawaited promises it catches roughly 75% of what `typescript-eslint` finds. On a codebase whose bugs are forgotten `await`s around bank calls, that gap is the wrong one to accept.

The rules kept from the sibling projects' ESLint setup map over, with two exceptions. `no-restricted-syntax` does not exist in Oxlint, so the ban on `as any` and `as never` is expressed through `typescript/no-explicit-any` and the `no-unsafe-*` family, which cover the same ground more precisely. `padding-line-between-statements` has no equivalent and is dropped; it was cosmetic.

### Why Oxfmt rather than Prettier

Import sorting lives in the formatter in this toolchain, not in the linter: Oxlint only ships the base `sort-imports` rule, which alphabetises specifiers and knows nothing about path groups. Keeping Prettier would therefore have cost the grouped import order the sibling projects enforce through `eslint-plugin-simple-import-sort`.

Oxfmt restores it, through `sortImports` with the custom group in `.oxfmtrc.json` that keeps `@archant/*` in its own block. It also passes 100% of Prettier's JavaScript and TypeScript conformance tests, honours `useTabs`, and formats Markdown, YAML and JSON, so nothing else is needed.

It is younger than the rest of the stack, announced as beta in February 2026 even though its own documentation calls it production-ready. The escape hatch is cheap: reinstall Prettier, restore `.prettierrc` with `{ "useTabs": true }`, run `pnpm format` once.

## Interface — `@archant/web`

| Package                  | Version | Role                           |
| ------------------------ | ------- | ------------------------------ |
| `vite`                   | 8.3.x   | Dev server and build, Rolldown |
| `react` / `react-dom`    | 19.3.0  | Rendering                      |
| `@tanstack/react-router` | 1.170.x | Typed routing                  |
| `@tanstack/react-query`  | 5.103.x | Server state                   |
| `@playwright/test`       | 1.63.x  | End-to-end tests               |

## Server — `@archant/api`

| Package               | Version | Role                       |
| --------------------- | ------- | -------------------------- |
| `hono`                | 4.13.x  | Routing and middleware     |
| `@hono/zod-validator` | 0.9.x   | Request validation         |
| `better-auth`         | 1.7.x   | Sessions and accounts      |
| `@t3-oss/env-core`    | 0.13.x  | Environment validation     |
| `zod`                 | 4.6.x   | Schemas at every boundary  |
| `vitest`              | 5.0.x   | Unit and integration tests |

## Data — `@archant/data`

| Package          | Version | Role                                      |
| ---------------- | ------- | ----------------------------------------- |
| `drizzle-orm`    | 0.45.x  | Schema, queries, derived types            |
| `drizzle-kit`    | 0.31.x  | Migration generation                      |
| `@libsql/client` | 0.18.x  | SQLite driver: local file and Turso alike |

## Typed API client

The interface talks to the server through Hono's RPC client (`hono/client`), which infers request and response types from the route definitions. No code generation step, no OpenAPI document to keep in sync, and a breaking change to a route fails `pnpm typecheck` in the interface package.

This differs from the sibling projects, which share types through the database package and hand-roll a fetch wrapper. That approach works, but it types the payload rather than the contract: a renamed route or a changed query parameter stays invisible until runtime.

## Deliberately absent

No Redis, no job queue, no broker, no ORM code generation step, no CSS framework decision yet, no state manager beyond TanStack Query. Each one has to earn its place in a pull request.

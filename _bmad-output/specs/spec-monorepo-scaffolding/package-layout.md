# Package layout

The files each package owns at the end of this scope. Nothing here implies business logic; every file is skeleton or wiring. Naming, import and test conventions are in `AGENTS.md`; package versions are in `docs/tech-stack.md`.

## `packages/db` — `@archant/db`

Raw TypeScript, no build step, consumed directly by the other two packages.

| File                | Holds                                                                        |
| ------------------- | ---------------------------------------------------------------------------- |
| `package.json`      | `main` and `types` pointing at `schema.ts`, exports for `./schema`, `./types` |
| `tsconfig.json`     | Extends `../../tsconfig.base.json`                                           |
| `schema.ts`         | One table, enough to prove migrations and types flow end to end              |
| `types.ts`          | `InferSelectModel` / `InferInsertModel` derivations                          |
| `client.ts`         | `createDb(url, authToken?)` returning a typed `Database`                      |
| `drizzle.config.ts` | drizzle-kit configuration, SQLite dialect                                    |
| `drizzle/`          | Generated migrations, never hand-edited                                      |

Columns are snake_case in SQL, camelCase in TypeScript.

## `packages/api` — `@archant/api`

A plain Node.js project: one entrypoint, no platform-specific code path.

```
src/
  index.ts                  entrypoint: reads env, builds the db client, serves
  app.ts                    assembly: chains route mounts, exports AppType
  env.ts                    validateEnv(runtimeEnv) on @t3-oss/env-core + Zod
  common/
    errors.ts               AppError, the closed ErrorCode union, toJSON()
    middlewares/            cross-cutting: request-id.ts, require-session.ts
  modules/
    health/
      routes.ts             Hono instance, handlers next to their routes
      routes.spec.ts
```

Vertical slices under `modules/`, shared code in `common/` beside them, following the NestJS convention where its words are neutral. Each module holds what it needs: `routes.ts`, `service.ts`, `repository.ts`, `schema.ts` for Zod contracts, and `middlewares/` when a middleware serves that module alone. This scope ships only the `health` module; feature modules arrive with their features.

Three layering rules, each with a reason rather than a preference:

- **Handlers stay in `routes.ts`, next to their route.** Hono's own guidance rejects Rails-style controllers: extracting a handler breaks the type inference that the typed client depends on. The handler reads validated input, calls the service, formats the response, and holds no logic.
- **Services ignore Hono and the request context.** They take data and return data. This is what makes extraction into a separate package mechanical the day the interface needs to recompute something locally.
- **Repositories are alone in talking to Drizzle.** No SQL anywhere else.

Four rules protect the typed client, and a contributor will break them without knowing why the client goes untyped:

- Chain route mounts and export `AppType` from the assembly point in `app.ts`.
- Use `async/await` in handlers; a returned `.then()` chain loses the response type.
- Prefer `c.json({ error }, 404)` over `c.notFound()`, which is untyped.
- Keep the same Hono version in `@archant/api` and `@archant/web`.

A single `app.onError` maps `AppError` to its JSON and anything else to a generic `INTERNAL_ERROR` 500. `app.notFound` returns `{"error":{"code":"NOT_FOUND"}}`.

## `packages/web` — `@archant/web`

| File                    | Holds                                                           |
| ----------------------- | --------------------------------------------------------------- |
| `index.html`            | Vite entry document                                             |
| `vite.config.ts`        | Vite 8 configuration                                            |
| `src/main.tsx`          | React root, router and query client providers                   |
| `src/routes/`           | TanStack Router route files                                     |
| `src/lib/api-client.ts` | `hc<AppType>()` from `hono/client`, typed against `@archant/api` |
| `playwright.config.ts`  | End-to-end configuration                                        |
| `e2e/health.spec.ts`    | One end-to-end test proving the interface reaches the API       |

## Repository root

| File                       | Holds                                                                     |
| -------------------------- | ------------------------------------------------------------------------- |
| `.github/workflows/ci.yml` | One job per gate command, on `push` to `main` and on `pull_request`        |
| `Dockerfile`               | Multi-stage build producing a self-contained Node image                    |
| `docker-compose.yml`       | One service plus a volume for the SQLite file; `docker compose up` is enough |

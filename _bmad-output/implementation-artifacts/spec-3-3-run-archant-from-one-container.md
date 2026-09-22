---
title: 'Story 3.3: Run Archant from one container'
type: 'feature'
created: '2026-09-22'
status: 'done'
baseline_commit: 'eb5588134ac8c1023e56b879abf60232984f5883'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/scaffolding-lessons.md'
  - '{project-root}/docs/adr/0002-container-reference-target.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Archant only runs as two dev servers from a checkout. Nothing applies migrations at start, the API does not serve the interface, there is no health route and no image, so a household cannot host it anywhere (FR46, FR47).

**Approach:** The API serves the built interface itself, migrates before it listens, and answers `GET /api/health`. One `Dockerfile` and one `docker-compose.yml` package that, and a CI job builds, starts, probes and stops the image.

## Boundaries & Constraints

**Always:**
- `index.ts` stays the only server entrypoint: env, `runMigrations`, the stale-preview purge, then `serve`. No seed exists yet; none is added.
- The interface is served only when `WEB_DIST` (optional, absolute path) is set; without it the API behaves exactly as today, so `pnpm api start:dev` is unchanged.
- Route order in `createApp`: Better Auth, session guard, `/api` routes, a JSON `NOT_FOUND` for any other `/api/*`, then static files, then the `index.html` fallback. The fallback never answers under `/api`, and a missing `/assets/*` file answers `404`, not the page.
- `index.html` is sent with `Cache-Control: no-cache`; `/assets/*` (content-hashed by Vite) with a one-year `immutable`. A stale `index.html` after an upgrade would request assets that no longer exist.
- `GET /api/health` runs one Drizzle query on `settings` (a migrated table, no raw SQL) and answers `200 { "data": { "status": "ok" } }`. Any database error answers `503` with the new `SERVICE_UNAVAILABLE` code, logs the error name only, and is translated in `fr.json`.
- No SIGTERM handler: with `init: true`, Node dies on the forwarded signal at once, and SQLite in WAL keeps every committed transaction. A handler that waits for keep-alive sockets could exceed one second.
- Image: `node:24-alpine`, two stages, runs as `node`, `DATABASE_URL=file:/data/archant.db`, `WEB_DIST=/app/packages/web/dist`, port 8787, a `HEALTHCHECK` on `/api/health`. The runtime stage holds the production dependencies of `@archant/api` and `@archant/data` only: no `drizzle-kit`, no Vite.
- `docker-compose.yml`: one service `archant`, `init: true`, `restart: unless-stopped`, a named volume on `/data`. It never uses `env_file: .env`, whose development `DATABASE_URL` and `BETTER_AUTH_URL` would break the container; it interpolates `BETTER_AUTH_SECRET` (required, `:?` with a message), `BETTER_AUTH_URL` from `ARCHANT_URL` (default `http://localhost:8787`), and passes `TRUSTED_PROXIES`, `APP_TIMEZONE`, `LOG_LEVEL` through.

**Never:** no image publishing to a registry, no second deployment target, no platform branch in code, no reverse-proxy or TLS files, no backup job, no `/api/sync` work (Epic 10).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Fresh volume | Empty database file | Migrations applied, then the server listens; health answers `200` | — |
| Health, database down | Closed client | — | `503 SERVICE_UNAVAILABLE`, no stack, no driver message |
| Deep link | `GET /comptes` with `WEB_DIST` | `200`, `index.html`, `no-cache` | — |
| Asset | `GET /assets/index-abc.js` | The file, `immutable` | Missing file: `404` |
| Unknown API route, signed in | `GET /api/nope` | — | `404 NOT_FOUND` JSON, never the page |
| Unknown API route, signed out | `GET /api/nope` | — | `401 UNAUTHORIZED` JSON, as today: the guard answers first |
| No `WEB_DIST` | `GET /` | — | `404 NOT_FOUND` JSON, as today |
| Stop | SIGTERM | Process exits within one second | — |

</frozen-after-approval>

## Code Map

- `packages/api/src/index.ts` -- current order: env (L12), logger, `createDb` (L14), `purgeStalePreviews` (L17), `createAuth`, `createApp`, `serve` (L37). `runMigrations` goes before `createDb`.
- `packages/data/migrate.ts` -- `runMigrations(url, authToken?)` (L14) already uses `drizzle-orm/libsql/migrator`, resolves `./drizzle` from its own file and closes its client. Reuse as is.
- `packages/api/src/app.ts` -- `createApi` chain (L39-46, keep every mount chained for `AppType`); `createApp` order (L60-69); `app.notFound` (L72) is app-wide, so a catch-all `get("*")` would preempt it. Add the `/api/*` JSON 404 and the static handlers after `.route("/api", ...)`, driven by a new optional `webDist` dependency.
- `@hono/node-server/serve-static` -- installed (2.1.1), unused. Its `onFound(path, c)` option sets the cache headers.
- `packages/api/src/routes/middleware/auth.ts` -- `PUBLIC_PATHS` (L13) already exempts `/api/health`; nothing to change.
- `packages/api/src/lib/errors.ts` -- `ERROR_STATUSES` (L7-21) gains `SERVICE_UNAVAILABLE: 503`. `packages/web/src/locales/fr.json` `errors` (L472) gains its sentence.
- `packages/api/src/env.ts` -- gains optional `WEB_DIST`. `.env.example` documents it and `ARCHANT_URL` (compose only).
- `packages/data/schema/settings.ts` -- `settings`, the table health reads.
- `packages/api/src/app.spec.ts` -- `describe("errors")` (L1350) is where the `/api/*` 404 and static tests belong; `testing/temp-database.ts`, `testing/auth.ts` for a migrated file and a session.
- `packages/web/e2e/start-api.ts` -- calls `runMigrations` itself (L17), now redundant. `playwright.config.ts` `webServer` (L50-66) runs the API on 8788 and `vite preview` on 4174.
- `.github/workflows/ci.yml` -- jobs `gate` and `e2e`; a third job `image` joins them.
- Reference only, never copy blindly: `git show bb0b0ca:Dockerfile`, `:docker-compose.yml`, `:.dockerignore`, `:.github/workflows/ci.yml` (abandoned scaffolding; its paths used `/health`, its CMD ran `migrate.ts` separately).
- `docs/deployment.md` L5 says "None of this is built yet"; L32 documents the reset through `pnpm`, which the runtime image will not carry.

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/routes/health.spec.ts` -- tests first: `200` on a migrated file, `503` with a closed client, reachable without a session.
- [x] `packages/api/src/routes/health.ts`, `app.ts`, `lib/errors.ts`, `locales/fr.json` -- the route mounted in the `createApi` chain, the new code and its sentence.
- [x] `packages/api/src/app.spec.ts` -- the static and 404 rows of the matrix, against a temporary directory holding `index.html` and one asset.
- [x] `packages/api/src/app.ts`, `env.ts`, `.env.example` -- `/api/*` JSON 404, `serveStatic`, `index.html` fallback, cache headers, `WEB_DIST`.
- [x] `packages/api/src/index.spec.ts` -- spawns `node src/index.ts` on a fresh temporary file and a free port (`PORT` refuses 0; ask `net` for one): the first health call answers `200` (migrations ran before listening), then SIGTERM ends the process within 1000 ms.
- [x] `packages/api/src/index.ts` -- `runMigrations` before anything touches the database, then `logger.info("migrations applied")`.
- [x] `packages/web/e2e/start-api.ts`, `playwright.config.ts`, `e2e/settings.ts` -- one server: build the interface, then start the API with `WEB_DIST` on one port, so the suite drives the production topology. Drop the explicit `runMigrations` and the preview proxy's `TRUSTED_PROXIES`.
- [x] `packages/web/e2e/serving.spec.ts` -- reloading a deep link such as `/comptes` shows the page; `/api/nope` shows JSON, not the interface.
- [x] `Dockerfile`, `.dockerignore`, `docker-compose.yml` -- per the constraints above; the reset command becomes `node packages/api/src/cli/reset-password.ts`.
- [x] `.github/workflows/ci.yml` -- job `image`: `docker compose build`; `up --detach --wait` with a generated `BETTER_AUTH_SECRET`; `curl` health and assert the body; `curl /api/nope` and assert JSON; `docker compose stop --timeout 1` then assert exit code `143` (SIGKILL after the timeout would give `137`); `logs` and `down --volumes` always.
- [x] `docs/deployment.md`, `AGENTS.md`, `README.md` -- Docker section with the commands and variables, `TRUSTED_PROXIES` behind a reverse proxy (closes the deferred item from Story 3.1), the corrected reset command, the new e2e topology in Testing.

**Acceptance Criteria:**
- Given a clone with `BETTER_AUTH_SECRET` set, when I run `docker compose up`, then `http://localhost:8787/` shows `/setup` and `/api/health` answers `200`.
- Given the verification gate of `AGENTS.md` and `pnpm test:e2e`, when they run, then every command passes and no tracked file changes.

## Implementation Notes

- The e2e server keeps `TRUSTED_PROXIES=127.0.0.1,::1`, against the task that dropped it. The Design Notes assumed every browser request shares `127.0.0.1` harmlessly, but the `clientAddress` fixture gives each test its own `x-forwarded-for` so tests do not share Better Auth's rate-limit buckets; with the trust removed, three tests failed on "Trop de tentatives". Loopback now stands in for the reverse proxy.
- `.pnpmfile.cjs` removes better-auth's optional peers `vitest` and `drizzle-kit`, and env-core's `typescript`. pnpm links an optional peer whenever the workspace has it, and `pnpm install --prod` kept those links, so the first runtime image carried vitest, Vite and drizzle-kit, which the constraints forbid.
- `serveStatic`'s `onFound` runs after the response is built, so a header set there never reaches it. A small `cacheControl` middleware sets the header after `next()` instead.
- The health query lives in `services/health.ts`: AD-1 lets only services import `db`.

## Spec Change Log

## Review Triage Log

| # | Source | Location | Finding | Verdict | Evidence | Route |
|---|--------|----------|---------|---------|----------|-------|
| 1 | blind | `app.ts` | The served interface carries no security headers, so a third-party site can frame the sign-in page | medium | No `X-Frame-Options`, `nosniff` or `Referrer-Policy` on any response; the page now comes from the API. Hono's `secureHeaders()` is one line. | patch |
| 2 | blind, edge | `index.ts` | A failed migration is an unhandled rejection printing the driver's stack outside pino | low | True, but a migration failure is exactly when an operator needs the full message, and it carries no amount, IBAN or token. The fix adds a branch. Rejected. | |
| 3 | blind | `docs/deployment.md` | Backups say nothing about the `archant-data` volume, WAL, or the image lacking `sqlite3` | medium | The Backups section predates this story and the architecture documents `VACUUM INTO`; writing the procedure is its own piece of documentation. | defer |
| 4 | blind | `docs/deployment.md` | Binding to loopback is documented as an edit of the tracked `docker-compose.yml`, which the next `git pull` conflicts with | low | Real on every upgrade behind a proxy. A direct documentation fix: a `compose.override.yml` with `ports: !override`. | patch |
| 5 | blind | `docker-compose.yml` | Compose interpolates the development `.env`, so its secret reaches the container | low | Documented in the file and in `docs/deployment.md`; a self-hosting checkout holds the production `.env`. Rejected. | |
| 6 | blind, verification | `ci.yml` | Nothing checks that the runtime image excludes vitest, Vite, drizzle-kit and TypeScript | medium | Pre-verified. A new optional peer would bring them back with every step green. | patch |
| 7 | blind | `ci.yml` | CI never restarts on an already-migrated volume, the documented upgrade path | low | Idempotence of the migrator is untested in the image; one `up --wait` after the stop settles it. The `/setup` redirect is client routing, covered by the e2e `setup` project. | patch |
| 8 | blind, edge | spec | The Drop-`TRUSTED_PROXIES` task is ticked while the code keeps it; Design Notes contradict Implementation Notes | — | The fix edits this build's spec; the deviation is recorded in Implementation Notes. Rejected. | |
| 9 | blind, edge, verification | `cli/reset-password.ts` | The usage line names `pnpm api reset-password`, which the image does not carry | low | L35. A direct correction of one string. | patch |
| 10 | blind, edge | `index.spec.ts` | `freePort` releases the port before the child binds it | low | A race with nothing else in the suite that binds random ports; it would fail loudly. Rejected. | |
| 11 | edge | `index.spec.ts` | `exit` registered after the child already exited would hang | false | The first test would already have failed on a dead server; a vanished child fails loudly on the Vitest timeout. | |
| 12 | blind | `app.ts` | A missing non-asset file such as `/favicon.ico` answers `index.html` | low | Browsers ignore it; distinguishing needs an extension rule. Rejected. Path traversal: `serveStatic` refuses `..` segments. | |
| 13 | blind | `app.ts` | Assets are sent uncompressed | low | A reverse proxy compresses; not asked by the intent. Rejected. | |
| 14 | blind | `vite.config.ts` | `preview.proxy` is dead configuration | false | `pnpm web preview` is still a package script a developer runs. | |
| 15 | edge | `env.ts` | An absolute `WEB_DIST` pointing nowhere leaves a healthy container answering JSON 404 on every page | low | `serveStatic` logs the missing root at start, and the image sets the path itself. Rejected. | |
| 16 | edge | `Dockerfile` | `HEALTHCHECK` hard-codes 8787 while `PORT` can be overridden | low | A direct correction: the shell form reads `$PORT`. | patch |
| 17 | edge | `docker-compose.yml` | A root-owned bind mount on `/data` makes SQLite unwritable | low | The documented setup is a named volume, which inherits `node`. Rejected. | |
| 18 | verification | `ci.yml` | The documented in-container reset command is never executed | medium | Pre-verified. `exec -T` without a terminal exits 1 after loading every module, proving the command's graph resolves in the image. | patch |

## Design Notes

The e2e suite moves to one server because it is the only way Playwright can see the fallback and the `/api` 404 as a browser does. It also removes a proxy that does not exist in production. Every browser request still comes from `127.0.0.1`, so Better Auth's sign-in limit behaves as before.

`docker compose stop --timeout 1` turns the one-second criterion into an exit code: `143` means the process died of SIGTERM, `137` means Docker had to kill it.

## Verification

**Commands:**
- `pnpm install --frozen-lockfile && pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test` -- all pass, `git status` clean afterwards.
- `pnpm test:e2e` -- the three projects pass against the single server.
- `BETTER_AUTH_SECRET=$(openssl rand -base64 32) docker compose up --build --detach --wait && curl -s localhost:8787/api/health && docker compose stop --timeout 1 && docker inspect -f '{{.State.ExitCode}}' $(docker compose ps -aq archant)` -- `{"data":{"status":"ok"}}`, then `143`.

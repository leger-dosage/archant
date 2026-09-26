---
title: 'Story 11.9: A first start that says what is wrong'
type: 'bugfix'
created: '2026-09-26'
status: 'done'
baseline_commit: '49b5ad5f97acc470c089278ac601bbd408500d73'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-11-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `serve()` in `packages/api/src/index.ts` listens on the wildcard `::`, and Node sets `SO_REUSEADDR`, so on macOS it starts beside another server already bound to `127.0.0.1` or `::1` on the same port (checked with Node 24: both bind). Vite proxies `/api` to `localhost:PORT`, reaches the other server, and the interface fails. With the API down or impostored, `_authed`'s `beforeLoad` throws `ApiError("NETWORK_ERROR")`, no route has an `errorComponent`, and TanStack's default shows « Something went wrong! » with the bare code, after seven seconds of query retries.

**Approach:** Before migrating, the API connects to `127.0.0.1:PORT` and `[::1]:PORT`; if either accepts, it logs a fatal line naming the port and `PORT` and exits 1. A listen error `EADDRINUSE` ends the same way. The root route gets an `errorComponent` that explains in French, and the README states where the database lives.

## Boundaries & Constraints

**Always:**
- Probe in `packages/api/src/lib/port.ts`: `loopbackListener(port)` returns the first loopback address that accepts a TCP connection, else `null`; a refused or failed connection counts as free, with a 500 ms timeout per address. It runs right after `validateEnv` and `createLogger`, before `runMigrations`, so a conflict touches no database.
- Conflict log: `logger.fatal({ port }, …)`, message in English naming the port and telling to stop the other server or set `PORT` in `.env`; then `process.exit(1)`. The same message on a `serve()` server `error` event with code `EADDRINUSE`; any other listen error is logged fatal with its code and exits 1. No stack trace printed for these cases.
- `packages/web/src/routes/__root.tsx` gets `errorComponent: RootError` (`packages/web/src/components/RootError.tsx`), rendered without the sidebar. For `errorCodeOf(error) === "NETWORK_ERROR"`: a heading « L'API ne répond pas », a sentence naming `pnpm api start:dev` and the `PORT` variable of `.env`, and a « Réessayer » button (`common.retry`). Any other error: a heading « Une erreur est survenue », the translated `errors.<code>` sentence and the same button. The code is never shown alone.
- « Réessayer » calls `router.invalidate()` then the boundary's `reset`, so `beforeLoad` reruns and the page loads once the API answers.
- `sessionQuery` in `packages/web/src/lib/auth-client.ts` maps a thrown `authClient.getSession()` to `NETWORK_ERROR`, as it already maps a returned error: better-fetch throws the browser's `TypeError` when no response arrives, which `errorCodeOf` reads as `INTERNAL_ERROR` today.
- `sessionQuery` does not retry `NETWORK_ERROR`, so the page appears at once rather than after the backoff; other queries keep the default retry.
- Every visible string in `fr.json`, under a new `startError` namespace; vouvoiement, no exclamation mark.
- README « Getting started »: one sentence saying the database is the SQLite file `local.db` at the repository root, which the API creates and migrates at start, so no container or database server is needed.

**Never:** no probe of `/api/health` from the interface, no new API endpoint or error code, no environment variable, no change to the query toasts of pages already loaded, no `defaultErrorComponent` on the router (page errors stay where they are today), no attempt to bind `127.0.0.1` explicitly (the container must keep listening on every interface).

## I/O & Edge-Case Matrix

| Scenario | State | Expected |
|----------|-------|----------|
| Port taken on IPv4 loopback | another server on `127.0.0.1:PORT` | API logs fatal with `port`, mentions `PORT`, exits 1, no « migrations applied » line |
| Port taken on IPv6 loopback | another server on `[::1]:PORT` | same |
| Port free | nothing listening | starts as today |
| API down | `/api/**` requests fail | root error page, API wording, retry button |
| Other server answers | `/api/auth/get-session` answers 404 HTML | same page as API down |
| Retry succeeds | API back, click « Réessayer » | the requested page loads |
| Other failure | `beforeLoad` throws `ApiError("INTERNAL_ERROR")` | generic heading with `errors.INTERNAL_ERROR` text |

</frozen-after-approval>

## Code Map

- `packages/api/src/index.ts` -- entrypoint; insert the probe before `runMigrations`, attach `error` to the server `serve()` returns.
- `packages/api/src/lib/port.ts` (new), `port.spec.ts` -- `loopbackListener`; tests with a `node:net` server on `127.0.0.1` and `::1`, port 0.
- `packages/api/src/index.spec.ts` -- `freePort`, spawn pattern with a bare env; add a `describe` that holds a port on `127.0.0.1`, spawns the entrypoint and expects exit code 1 and the fatal line.
- `packages/web/src/routes/__root.tsx` -- `createRootRouteWithContext`; add `errorComponent`.
- `packages/web/src/components/RootError.tsx` (new) -- uses `errorCodeOf` and `isErrorCode` from `lib/api.ts`, `Button` from `components/ui/button`.
- `packages/web/src/lib/api.ts` -- `unwrap` already maps a network failure and a non-envelope body to `NETWORK_ERROR`; reuse, do not change.
- `packages/web/src/lib/auth-client.ts` -- `sessionQuery`; wrap `getSession` in `try`, add `retry` that skips `NETWORK_ERROR`. `isSetupOpen` goes through `unwrap`, already covered.
- `packages/web/src/main.tsx` -- default query retry; unchanged.
- `packages/web/src/locales/fr.json` -- `common.retry` exists; add `startError`.
- `packages/web/e2e/start-error.spec.ts` (new) -- `page.route("**/api/**")` abort, then fulfil 404 HTML, then unroute and retry.
- `README.md` -- « Getting started ».

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/lib/port.spec.ts`, `port.ts` -- tests first: taken on IPv4, on IPv6, free; then `loopbackListener`.
- [x] `packages/api/src/index.spec.ts`, `index.ts` -- conflict test first (exit 1, fatal line naming the port and `PORT`, no migration line); then the probe and the `EADDRINUSE` handler.
- [x] `packages/web/e2e/start-error.spec.ts` -- API down, other server answering, retry reaching the dashboard; written before the component.
- [x] `packages/web/src/components/RootError.tsx`, `routes/__root.tsx`, `lib/auth-client.ts`, `locales/fr.json` -- the error page, its wiring, the session retry rule.
- [x] `README.md` -- the `local.db` sentence.

**Acceptance Criteria:**
- Given the finished story, when `pnpm test` and `pnpm test:e2e` run, then every matrix row has an automated test: Playwright for the error page, Vitest for the rest.

## Implementation Notes

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Evidence | Route |
|---|---|---|---|
| `outcome` in `index.spec.ts` resolves on `exit`, before stdout may be drained (blind, edge, verification) | medium | Node emits `exit` before the child's stdio closes; the one-line assertion can flake. | patch |
| `server.on("error")` comment claims to catch a later taker, which macOS binds beside; a post-listen error logs « could not listen » (blind, edge) | low | `SO_REUSEADDR` lets the bind succeed on macOS; `net.Server` emits `error` on an accept failure too. Direct rewording. | patch |
| `sessionQuery` retry predicate: `failureCount < 3` is dead (blind, edge) | low | The `queryFn` only throws `NETWORK_ERROR` now. Direct simplification to `retry: false`. | patch |
| `__root.tsx` comment says page errors keep their own handling (blind, edge) | low | No route declares an `errorComponent`, so page errors bubble to the root, as they bubbled to TanStack's default there before. Direct rewording. | patch |
| `RootError` drops `params`, so `{{url}}` would show raw (blind) | low | `errorMessage` in `lib/error-toast.ts` already fills it. Direct swap. | patch |
| The API-down sentence tells a container self-hoster to run a dev command (blind) | low | The container serves the interface itself, so the page shows there only if the API died; prefixing « En développement » is a direct text change. | patch |
| No test reaches the `server.on("error")` handler (blind, edge, verification) | medium | The loopback probe always exits first in tests; a portable bind failure that escapes it is not reproducible. | defer |
| A Better Auth 5xx or 429 on get-session reads as « L'API ne répond pas » (blind, edge) | low | The mapping of any returned error to `NETWORK_ERROR` predates this story; get-session is not sign-in rate-limited; a status split adds a branch. | rejected |
| A non-`ApiError` shows without a console trace (blind) | low | Rare render crash; adds a branch; the generic page still says something failed. | rejected |
| `::1` tests fail on a host without IPv6 loopback (blind, edge) | maybe-false | GitHub-hosted Ubuntu runners have `::1`; would only be low. | rejected |
| `answers null` test flakes if the freed port is reused at once (edge) | low | Same pattern as `freePort` already in `index.spec.ts`; a guard adds complexity. | rejected |
| `docs/deployment.md` does not mention the new port stop (blind) | low | The log line names the port and `PORT` itself. | rejected |
| Diff omits the spec and sprint status (blind) | false | Deliberately excluded from the review diff; the spec went to the edge-case layer as claims. | rejected |

## Design Notes

Why a connect probe and not a stricter bind: Node exposes no way to clear `SO_REUSEADDR`, and binding `127.0.0.1` would stop the container from answering outside itself. A connection to each loopback address is what Vite's proxy does, so it finds exactly the server that would steal the requests. The probe leaves a short race with a server starting at the same instant; `EADDRINUSE` covers the platforms where the bind itself fails.

Why the root route only: the failure the owner met happens in `beforeLoad` of `_authed`, `setup` and `sign-in`, before any layout renders. No route declares its own `errorComponent`, so a page error bubbles to the root as it did before, and now shows `RootError` in French instead of TanStack's English default.

Sure is a Rails application served by one process and has no equivalent; nothing to align on.

## Verification

**Commands:**
- `pnpm typecheck && pnpm lint:code && pnpm test` -- expected: green.
- `pnpm test:e2e` -- expected: green.

**Manual checks (if no CLI):**
- Run `python3 -m http.server 8787 --bind 127.0.0.1`, then `pnpm api start:dev`: the API stops with the fatal line.

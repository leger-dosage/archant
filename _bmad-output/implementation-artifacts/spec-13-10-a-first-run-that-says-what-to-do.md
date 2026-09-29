---
title: 'Story 13.10: A first run that says what to do'
type: 'feature'
created: '2026-09-29'
status: 'done'
baseline_commit: 'ae89df14de682d49e6f9540f8a9e1a375e632629'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-13-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** On a first run behind Tailscale with `ARCHANT_URL` left empty, `BETTER_AUTH_URL` falls back to `http://localhost:8787`, so the `ts.net` address is a foreign origin. `POST /api/setup` is JSON, which `csrf()` never checks, so setup creates the administrator; the automatic sign-in that follows gets Better Auth's `403 INVALID_ORIGIN`, the page silently moves to `/sign-in`, and every sign-in there ends in the toast « Cette action n'est pas autorisée. ». Nothing names the cause. Separately, `/setup` says the token is « dans les journaux du serveur » without saying which command shows them, and `docs/deployment.md` gives no command after `up --detach --wait`, which prints no log.

**Approach:** One middleware, ahead of `csrf()` and Better Auth, refuses any unsafe `/api` request whose `Origin` differs from `BETTER_AUTH_URL`'s origin with a new code `ORIGIN_MISMATCH` (403) and one `warn` line; sign-in and setup show its French message inline. The setup hint names where to read the token, and the docs gain the `grep` and the confirmed `ts.net` statements.

## Boundaries & Constraints

**Always:**
- The middleware acts only on `POST`, `PUT`, `PATCH`, `DELETE` with an `Origin` header that is present, not `"null"`, and not equal to `new URL(trustedOrigin).origin`. An absent or `"null"` origin goes on to `csrf()` and Better Auth as today.
- It answers in the API envelope, `/api/auth/*` included: the refusal is Archant's, not Better Auth's, and happens before its handler, so Better Auth logs nothing.
- Log: `logger.warn({ origin, expected }, "request from another origin refused")`, one per refused request, nothing else from the request.
- The response names neither origin: an unauthenticated caller learns nothing about the configuration.
- `errors.ORIGIN_MISMATCH` in `fr.json`: « Archant est configuré pour une autre adresse. Donnez à ARCHANT_URL l'adresse affichée dans la barre d'adresse, puis redémarrez Archant. » Plain text, no interpolation, so `showErrorToast` shows it unchanged wherever it lands.
- `setup.tokenHint`: « Affiché dans les journaux du serveur à chaque démarrage : `docker compose logs archant` avec le conteneur, sinon le terminal où tourne le serveur. » as plain text.
- Sign-in and setup show `ORIGIN_MISMATCH` in a `role="alert"` paragraph under the submit button, not a toast: the fix means editing a file and restarting, longer than a toast lasts.

**Never:** no change to `csrf()`, to Better Auth's `trustedOrigins` or to `BETTER_AUTH_URL` defaults; no second trusted origin; no `params` carrying an origin; no check on `GET`; no new dependency; no change to the token log line in `packages/api/src/index.ts`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Sign-in, wrong address | `POST /api/auth/sign-in/email`, `Origin: http://127.0.0.1:8788`, trusted `http://localhost:8788` | 403 `ORIGIN_MISMATCH`, no `set-cookie`, one `warn` with both origins | page shows the alert |
| Setup, wrong address | `POST /api/setup` from a foreign origin, no user | 403 `ORIGIN_MISMATCH`, no user created, limiter not consumed | page shows the alert |
| Upload, wrong address | multipart `POST /api/accounts/:id/imports` from a foreign origin | 403 `ORIGIN_MISMATCH`, nothing written | toast with the same text |
| Same origin | any unsafe method, `Origin` equals trusted origin | unchanged | N/A |
| No origin | `POST /api/sync` from `curl`, in-process test requests | unchanged | N/A |
| `Origin: null` form post | multipart, `Origin: null` | unchanged: `csrf()` answers `FORBIDDEN` | N/A |
| Read | `GET /api/setup` from a foreign origin | unchanged | N/A |

</frozen-after-approval>

## Code Map

- `packages/api/src/app.ts:217-228` -- `createApp`; mount the new middleware on `/api/*` just before the `csrf()` block. Keep `csrf()` and its `/api/sync` exception. `onError`'s 403 branch stays `FORBIDDEN`.
- `packages/api/src/routes/middleware/` -- new `same-origin.ts` beside `daily-sync.ts` and `auth.ts`, taking `{ trustedOrigin, logger }` from `AppDeps`.
- `packages/api/src/lib/errors.ts:12-13` -- add `ORIGIN_MISMATCH: 403`; narrow `FORBIDDEN`'s comment to « a form post with no origin ».
- `packages/api/src/lib/logger.ts:12` -- `createLogger(level, destination)` captures lines in tests.
- `packages/api/src/routes/middleware/auth.spec.ts:162-189` -- foreign-origin upload test, now `ORIGIN_MISMATCH`.
- `packages/api/src/app.spec.ts:7318-7346` -- foreign renew/delete test, now `ORIGIN_MISMATCH`.
- `packages/api/src/services/setup.spec.ts` -- setup route tests; add the wrong-origin case.
- `packages/app/src/routes/sign-in.tsx:121-129` -- 403 branch and its comment; `failure` state and alert at `:179-183`. Better Auth's client spreads the JSON body into `error`, so the code is `error.error.code`: read it with a small Zod parse.
- `packages/app/src/routes/setup.tsx:84-108` -- `ApiError` handling; add `ORIGIN_MISMATCH` before the generic toast.
- `packages/app/src/locales/fr.json:1154,1185` -- `setup.tokenHint`, `errors.*`.
- `packages/app/e2e/auth.setup.ts` -- the only moment setup is open; `http://127.0.0.1:8788` is a foreign origin for the suite's server (`WEB_URL` is `localhost`).
- `packages/app/e2e/auth.spec.ts:30-37` -- « Better Auth refuses a sign-in from another origin ».
- `docs/deployment.md:31-37` (first run), `:189` (`ts.net` unconfirmed); `docs/hosting.md:60` (step 5), `:108` (step 8).

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/routes/middleware/same-origin.spec.ts` -- every matrix row against `createApp`, with a captured logger: status, code, exactly one `warn` carrying `origin` and `expected`, nothing written -- test first.
- [x] `packages/api/src/lib/errors.ts`, `routes/middleware/same-origin.ts`, `app.ts` -- the code, the middleware with a why-comment, the mount.
- [x] `auth.spec.ts`, `app.spec.ts`, `setup.spec.ts` -- existing foreign-origin assertions move to `ORIGIN_MISMATCH`; setup from a foreign origin creates no user.
- [x] `packages/app/e2e/auth.spec.ts` -- signed out, `http://127.0.0.1:8788/sign-in`, submit: the alert shows the message; the API test also checks the code -- test first.
- [x] `packages/app/e2e/auth.setup.ts` -- before the real setup: the hint names `docker compose logs archant`; a submit from `http://127.0.0.1:8788/setup` shows the alert and the page stays on `/setup` -- test first.
- [x] `fr.json`, `sign-in.tsx`, `setup.tsx` -- texts and inline alerts.
- [x] `docs/deployment.md` -- after « Open http://localhost:8787 », a block with `docker compose logs archant | grep 'Setup is open'`, saying `--wait` shows no log; `:189` states Enable Banking accepts a `ts.net` redirect URL for a production application (checked 2026-09-29) and drops the sandbox advice.
- [x] `docs/hosting.md` -- step 5: an empty `ARCHANT_URL` leaves `http://localhost:8787`, so every sign-in from the `ts.net` address is refused and the page says to set it; step 8: drop « after checking on a sandbox application ».

**Acceptance Criteria:**
- Given the `#connecting-a-bank` anchor, when the docs change, then it still resolves.
- Given `pnpm test` and `pnpm test:e2e`, when they run, then every matrix row and the hint have a test.

## Implementation Notes

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Evidence / route |
|---|---|---|
| `same-origin.spec.ts`: `withSession` mutates the shared `app.request`, so the no-origin tests send `TEST_ORIGIN` | medium | Confirmed at `testing/auth.ts:83-101`; the no-origin matrix row was untested. Patch: separate signed-in app. |
| The « Read » row is tested after setup closed, asserting `FORBIDDEN` | low | Real: never proves a foreign `GET /api/setup` answers 200 while open. Patch. |
| No test proves `BETTER_AUTH_URL` is reduced to its origin; a trailing slash would refuse every write | medium | Dropping `.origin` keeps every test green; `env.ts` accepts `/`. Patch: test with a trailing slash. |
| e2e network guard lets `127.0.0.1` on any port through | low | Direct fix. Patch: only the suite's port. |
| `sign-in.tsx` 403 branch lost its why-comment | low | Direct fix. Patch. |
| `.env.example` and the « Variables » row still say only a sign-in or an upload is refused | low | Now incomplete. Patch: wording. |
| `docs/deployment.md` « died with its start » is obscure and mixes two ideas | low | Patch: wording. |
| The message names only `ARCHANT_URL`; outside the container the variable is `BETTER_AUTH_URL` | low | Real for a plain Node host, but the text is the frozen intent, taken from the epic's acceptance criterion. Rejected: the fix edits the spec. |
| The new `setup.tokenHint` drops « Il change à chaque redémarrage » | low | A stale token gets `SETUP_TOKEN_INVALID`, whose message already says to copy the one from the last start. Rejected. |
| The `warn` line is unbounded: a hostile page can post in a loop | low | Only while the owner keeps such a page open; header size bounds `origin`. Rate limiting adds a branch. Rejected. |
| The upload toast has no interface test | low | An upload needs a session, which a foreign host never has; the API test covers the code and the toast path is generic. Rejected. |
| `sameOrigin` ignores extra origins from `BETTER_AUTH_TRUSTED_ORIGINS` | false | Archant never sets `trustedOrigins`, and `.env.example`, the contract, lists no such variable. Rejected. |
| A browser sending only `Referer` still gets Better Auth's `INVALID_ORIGIN` | false | Browsers always send `Origin` on a `POST` fetch; the remaining 403 keeps the `FORBIDDEN` toast. Rejected. |
| `sprint-status.yaml` says `in-progress` while the spec is `in-review` | false | Step 5 of the workflow moves it to `review`. Rejected. |

## Design Notes

A pre-check rather than mapping each refusal: Better Auth's `INVALID_ORIGIN` answers in its own shape and logs at `error` plus an `info` listing trusted origins, `csrf()` throws a bare `HTTPException`, and setup is not checked at all. One middleware gives one code, one log line, and refuses setup before it creates an administrator the owner then cannot sign in to.

## Verification

**Commands:**
- `pnpm lint:code && pnpm typecheck && pnpm test` -- expected: green, new tests included.
- `pnpm test:e2e` -- expected: green.
- `pnpm format && pnpm lint:format` -- expected: green, no tracked file changed by the second run.

**Manual checks:**
- `pnpm api start:dev`, then `curl -i -X POST -H 'content-type: application/json' -H 'origin: http://example.test' -d '{}' http://localhost:8787/api/auth/sign-in/email`: `403` with `ORIGIN_MISMATCH`, and the API terminal shows one `warn` naming `http://example.test` and `http://localhost:5173`.

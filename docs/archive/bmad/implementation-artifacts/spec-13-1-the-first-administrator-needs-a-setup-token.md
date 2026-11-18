---
title: 'Story 13.1: The first administrator needs a setup token'
type: 'feature'
created: '2026-09-27'
status: 'done'
baseline_commit: '9cb755d885776da81ebb557e04d33d568eaee7b1'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-13-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `POST /api/setup` creates the administrator for whoever calls it first. A fresh domain's certificate lands in public certificate transparency logs that bots scan within minutes, so a stranger can claim a new instance before its owner does.

**Approach:** With no user in the database, the server generates a random setup token at start, keeps it in memory and logs it. `POST /api/setup` requires it, compared in constant time, and is rate-limited per address; the setup form gets a « Jeton de configuration » field.

## Boundaries & Constraints

**Always:**
- Token: `randomBytes(24).toString("base64url")`, generated in `index.ts` after migrations only when `users` is empty, passed to `createApp` as `setupToken: string | null`. Never stored, never returned by an endpoint. A restart makes a new one.
- Logged once at `warn`, token in the message text so `docker compose logs archant` shows it plainly: `Setup is open. Open /setup and enter the setup token <token>. A new one is printed at every start.` `warn`, not `info`: the owner must see it at `LOG_LEVEL=warn`, which the e2e server uses. The why-comment states this is the one secret a log may carry, worthless once setup is done.
- `POST /api/setup` order: closed check (a user exists → `403 FORBIDDEN`, body unread), then the rate limit, then body validation, then the token check, then the existing claim of `setup_completed_at`. Today the validator runs first, so a closed setup answers `400` to a bad body; this story fixes that.
- Token check: `timingSafeEqual` on SHA-256 digests, as `carriesSecret` in `routes/sync.ts` does. Empty, wrong, or a `null` server token → `403 SETUP_TOKEN_INVALID`, nothing written, nothing logged but the refusal without the submitted value.
- `setupSchema` gains `token: z.string().trim().max(200)`, no minimum, so an empty token reaches the check and answers `403`. The form's `setupFormSchema` adds `.min(1)` so the form reports « Ce champ est obligatoire. » before sending.
- Rate limit: Better Auth's sign-in rule, 3 requests per 10 seconds per client address, counting every `POST /api/setup` while setup is open. Excess answers `429 TOO_MANY_REQUESTS` before the body is read. Kept in memory: a restart also changes the token, so resetting the counts gives an attacker nothing. Expired windows are pruned on each call, so a spread of addresses cannot grow the map without bound.
- Client address: the one Better Auth's `getIP` would pick, from the request `withForwardedFor` rebuilds, walking `x-forwarded-for` right to left past `TRUSTED_PROXIES`. Better Auth does not export `getIP`; add `clientKey` beside `forwardedFor` in `lib/client-address.ts`. No address → one shared bucket, as Better Auth does.
- Two new codes in `ERROR_STATUSES`, each with an `errors.<CODE>` line in `fr.json`: `SETUP_TOKEN_INVALID: 403`, `TOO_MANY_REQUESTS: 429`.
- Form: « Jeton de configuration » first, `autoComplete="off"`, hint « Affiché dans les journaux du serveur à son démarrage. Il change à chaque redémarrage. ». `SETUP_TOKEN_INVALID` shows under that field, `TOO_MANY_REQUESTS` as a toast, `FORBIDDEN` still sends to `/sign-in`.
- `GET /api/setup` unchanged: `{ open: true }` or `403`.
- Docs: `README.md` « Getting started » and `docs/deployment.md` first launch say where to read the token (`pnpm api start:dev` output, `docker compose logs archant`).

**Never:** no environment variable to set or bypass the token, no token file on disk, no change to Better Auth's own rate limiting (Story 13.2), no new dependency, no token shown by any endpoint or page.

## I/O & Edge-Case Matrix

| Scenario | State / Input | Expected |
|----------|--------------|----------|
| Start, empty database | no user | one `warn` line with the token |
| Start, user exists | one user | no token line, `setupToken` is `null` |
| Right token | setup open | `201`, administrator created |
| Wrong token | setup open | `403 SETUP_TOKEN_INVALID`, no user, no `setup_completed_at` row |
| Empty token | setup open | `403 SETUP_TOKEN_INVALID` |
| Right token, invalid email | setup open | `400 VALIDATION_ERROR` with `fields` |
| Setup closed, any body, even not JSON | user exists | `403 FORBIDDEN` |
| Fourth POST in 10 s from one address | setup open | `429 TOO_MANY_REQUESTS`, body unread |
| Two addresses behind a trusted proxy | 3 POSTs each | none refused |
| Log of a refused attempt | wrong token | submitted value absent from logs |

</frozen-after-approval>

## Code Map

- `packages/api/src/index.ts` -- after `runMigrations` and `createDb`: count users, generate and log the token, pass `setupToken` to `createApp`.
- `packages/api/src/app.ts` -- `AppDeps` gains `setupToken: string | null`; `createApi` passes it with `clientAddress` and `trustedProxies` to `setupRoutes`.
- `packages/api/src/routes/setup.ts` -- insert the closed-check and rate-limit middlewares before `zValidator`.
- `packages/api/src/services/setup.ts` -- `SetupDeps` gains `setupToken`; `completeSetup` checks the token before the claim; export `hasUser` for `index.ts` and the middleware.
- `packages/api/src/routes/sync.ts` -- `carriesSecret` and its digest pattern; reuse the idea, or move the digest compare to a shared helper if both read better.
- `packages/api/src/lib/rate-limit.ts` (new), `rate-limit.spec.ts` -- fixed window per key, injectable clock for tests.
- `packages/api/src/lib/client-address.ts`, `.spec.ts` -- add `clientKey`.
- `packages/api/src/lib/errors.ts` -- two codes.
- `packages/api/src/schemas/setup.ts` -- `token` field.
- `packages/api/src/testing/auth.ts` -- `TEST_SETUP_TOKEN`; `buildTestApp` passes it; `setUpAndSignIn` sends it. Every API spec goes through this helper.
- `packages/api/src/services/setup.spec.ts` -- existing `postSetup`; extend for the matrix.
- `packages/api/src/index.spec.ts` -- spawn pattern with a bare env; assert the token line on an empty database and its absence after setup.
- `packages/app/src/routes/setup.tsx` -- field, `API_FIELDS` gains `token`, error mapping.
- `packages/app/src/locales/fr.json` -- `setup.token`, `setup.tokenHint`, `errors.SETUP_TOKEN_INVALID`, `errors.TOO_MANY_REQUESTS`.
- `packages/app/e2e/start-api.ts` -- spawn the API with `stdout` piped, forward every line to its own stdout, write the token from the setup line to a gitignored file named in `e2e/settings.ts`.
- `packages/app/e2e/auth.setup.ts` -- first a wrong token and the field error, then the file's token.
- `packages/app/e2e/outside-shell.spec.ts`, `start-error.spec.ts` -- mock `/api/setup`; check they still pass with the new field.
- `packages/api/src/routes/middleware/auth.ts` -- `/api/setup` stays public; unchanged.

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/lib/rate-limit.spec.ts`, `rate-limit.ts`, `client-address.spec.ts`, `client-address.ts` -- tests first: third request allowed, fourth refused, window reset, pruning, key walk past trusted proxies.
- [x] `packages/api/src/services/setup.spec.ts`, `testing/auth.ts` -- matrix rows as failing tests, then the helper carries the token.
- [x] `packages/api/src/lib/errors.ts`, `schemas/setup.ts`, `services/setup.ts`, `routes/setup.ts`, `app.ts` -- the check order above.
- [x] `packages/api/src/index.spec.ts`, `index.ts` -- the start log, test first.
- [x] `packages/app/e2e/start-api.ts`, `settings.ts`, `auth.setup.ts` -- e2e reads the printed token, test written before the form change.
- [x] `packages/app/src/routes/setup.tsx`, `locales/fr.json` -- the field and its errors.
- [x] `README.md`, `docs/deployment.md` -- where to find the token.

**Acceptance Criteria:**
- Given the finished story, when `pnpm test` and `pnpm test:e2e` run, then every matrix row has an automated test: Playwright for the form, Vitest for the rest, and the e2e `setup` project uses the token the test server printed.

## Implementation Notes

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Evidence | Route |
|---|---|---|---|
| No test proves the setup limiter ignores a forged `x-forwarded-for` without trusted proxies (verification) | medium | Pre-verified gap: passing the raw header to `clientKey` would keep every spec green and let a guesser rotate buckets. | patch |
| Test « reads a body only after the token » says the opposite of the order (blind) | low | `zValidator` runs before `completeSetup`; the test asserts the right token with a bad email, so only its title is wrong. Direct rename. | patch |
| `.env.example` `LOG_LEVEL` comment omits the hidden token above `warn` (blind) | low | AGENTS.md makes `.env.example` say what degrades; one line. | patch |
| Docs quote the message as plain text; the server writes pino JSON; README truncates it (blind) | low | `createLogger` writes JSON lines; one clause each. | patch |
| `AGENTS.md` e2e section does not mention the token file `start-api.ts` writes (blind) | low | A later edit back to `stdio: "inherit"` would break the setup project without a hint; the fix edits an agent-context file. | defer |
| « once a user exists » in `index.spec.ts` depends on the sibling tests (blind, edge, verification) | low | True, but the file already shares one child across tests and its SIGTERM test depends on it; the failure is loud, not a false pass. | rejected |
| `sameSecret` has no co-located spec (blind) | low | Covered through `carriesSecret` and every setup spec; a spec would assert nothing new. | rejected |
| 429 carries no `Retry-After` (blind, edge) | low | The interface shows a fixed sentence and never reads it; Better Auth's 429 is handled the same way. Adds surface. | rejected |
| `clientKey` rebuilds the `BlockList` per request (blind) | low | A handful of entries, on a route open only until the first user. | rejected |
| Limiter scans the whole map on each call, O(n²) under many addresses (blind) | low | Bounded by distinct keys in 10 s on a route open only before setup; a scheduled prune adds state. | rejected |
| `setupToken` stays `null` or stale if users change at runtime (blind, edge) | false | No path deletes or creates a user at runtime besides setup: the admin endpoints are in `ADMIN_PATHS`, disabled. | rejected |
| A token copied with the log's trailing period is refused (edge) | low | Real, but the answer names the token as wrong and a retry fixes it; stripping punctuation adds a branch to the contract. | rejected |
| `writeFile` of the e2e token is not awaited (blind, edge) | low | The line precedes `serve()`, Playwright waits for `/api/health`; a rejection would crash loudly, not pass. | rejected |
| Clients with no believable address share one bucket (edge) | low | `getConnInfo` always gives the TCP peer in the server; only in-process tests lack one. Same as Better Auth. | rejected |
| Several instances print several tokens (blind) | false | `docs/deployment.md` already requires exactly one container per database file. | rejected |
| Refusal log carries no client key (blind) | low | Would add an address to logs for a marginal diagnosis; not asked. | rejected |

## Design Notes

Why the token goes in the body, not a header: the form already posts JSON through `hc`, and the closed check needs no body, so a stranger on a closed instance is still refused unread. Why no minimum length in the API schema: the epic asks an empty token to answer `403`, not a field error.

Why an in-memory limiter and not Better Auth's: Better Auth limits only its own `/api/auth/*` paths and exports neither its limiter nor `getIP`. Twenty lines keyed like Better Auth avoid a dependency.

Sure has no setup token: its first user signs up through an open registration page. Archant has no public sign-up, and a single-household instance on a public domain is claimed by whoever comes first, so this goes further than Sure deliberately.

## Verification

**Commands:**
- `pnpm typecheck && pnpm lint:code && pnpm test` -- expected: green.
- `pnpm test:e2e` -- expected: green.

**Manual checks (if no CLI):**
- Delete `local.db`, run `pnpm api start:dev`: one `warn` line with the token. Restart: a different token. Create the administrator, restart: no token line.

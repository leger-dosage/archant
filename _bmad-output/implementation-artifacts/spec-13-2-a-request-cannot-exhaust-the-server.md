---
title: 'Story 13.2: A request cannot exhaust the server'
type: 'feature'
created: '2026-09-27'
status: 'done'
baseline_commit: '7f42b9907ea243b915038f48741949e44999e663'
route: 'dispatch'
review_loop_iteration: 1
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-13-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Only the file upload has a body limit, so any `/api` route, signed out included, reads a body of any size. `ofx-js` runs in exponential time on long tag names (24 characters take 360 ms, each two more multiply it by four) and in quadratic time on long whitespace runs and unclosed comments (400 KB of spaces take 81 s). Better Auth's sign-in limit lives in memory, forgotten at every restart, and is per address only, so many addresses guess in parallel.

**Approach:** One 64 KB body limit on every `/api` route but the upload. A pnpm patch of `ofx-js` rewrites its three super-linear regular expressions into equivalent linear ones. Better Auth's rate limit moves to the database, and a middleware in front of `/api/auth/sign-in/email` refuses sign-ins once too many attempts failed across all addresses.

## Boundaries & Constraints

**Always:**
- Body limit: Hono's `bodyLimit`, `maxSize: 64 * 1024`, mounted in `createApp` on `/api/*` right after `secureHeaders`, before `csrf`, Better Auth's handler and `requireSession`, wrapped in `except("/api/accounts/:id/imports", …)` so the upload keeps `MAX_IMPORT_BODY_BYTES`. Over the limit throws `AppError("PAYLOAD_TOO_LARGE")`, a new code at `413` with an `errors.PAYLOAD_TOO_LARGE` line in `fr.json`. A declared `Content-Length` over the limit is refused unread; a chunked body stops being read at the limit.
- `ofx-js` patch through `pnpm patch ofx-js@1.1.1` / `pnpm patch-commit`, recorded in `pnpm-workspace.yaml` `patchedDependencies`, file under `patches/`. Three edits in `ofx.js`, each keeping the output identical:
  - `sgml2Xml`: `/<([A-Z0-9_]*)+\.+([A-Z0-9_]*)>([^<]+)/g` → `/<([A-Z0-9_]*)\.+([A-Z0-9_]*)>([^<]+)/g`.
  - `sgml2Xml`: `/\s+</g` → `/(?<!\s)\s+</g`, so a whitespace run is tried once, from its start.
  - `parseXmlString`: `xml.replace(/<!--[\s\S]*?-->/g, "")` → a loop on `indexOf("<!--")` / `indexOf("-->")` that stops at the first unclosed comment.
- The `Dockerfile` copies `patches/` in both stages before `pnpm install --frozen-lockfile`.
- Per-address sign-in limit: `rateLimit: { enabled: true, storage: "database" }` in `createAuth`, Better Auth's own rules unchanged (sign-in: 3 per 10 s). Its table joins `packages/data/schema/auth.ts` as `rateLimits`, SQL `rate_limits`: `id` text primary key, `key` text unique not null, `count` integer not null, `last_request` integer not null (epoch ms), with a migration from `pnpm data generate`.
- Overall ceiling: a middleware on `POST /api/auth/sign-in/email` before `auth.handler`. It refuses with `429 TOO_MANY_REQUESTS`, unread, while the current window holds 20 failed sign-ins; after the handler, a `401` response counts one failure. Fixed window of 10 minutes, stored in a new table `sign_in_failures` (`id` text primary key, a single row `all`, `count` integer, `window_started_at` integer epoch ms) in `packages/data/schema/auth.ts`, updated in one statement or one write transaction. Limits and clock are options of the service with those defaults, so specs pass smaller ones.
- The sign-in page already maps any `429` to « Trop de tentatives »; it needs no change.

**Never:** no new dependency, no environment variable for the limits, no change to Better Auth's per-address rules or its `/api/auth/*` response shape, no fork or vendoring of `ofx-js`, no limit on routes outside `/api`, no change to the setup limiter of Story 13.1.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| JSON body over 64 KB | `POST /api/transactions`, signed out, then signed in | `413 PAYLOAD_TOO_LARGE`, nothing written | closed code |
| Same on Better Auth and setup | `POST /api/auth/sign-in/email`, `POST /api/setup` | `413 PAYLOAD_TOO_LARGE` | closed code |
| Chunked body over 64 KB | no `Content-Length` | `413 PAYLOAD_TOO_LARGE` | reading stops at the limit |
| Upload of 1 MB | `POST /api/accounts/:id/imports` | `201`, as today | 6 MB still refused as today |
| OFX with 40-character tag names | upload | answers under 1 s, `201` or `400 INVALID_IMPORT_FILE` | — |
| 5 MB OFX of one whitespace run, or of repeated `<!--` | upload | answers under 1 s | `400 INVALID_IMPORT_FILE` |
| Fourth sign-in in 10 s from one address, across a restart | new `createAuth` on the same database | `429` from Better Auth | — |
| 20 failures from 20 addresses in 10 min | 21st attempt, right password, new address | `429 TOO_MANY_REQUESTS`, Better Auth not called | — |
| Same, after a restart | new app on the same database | still `429` | — |
| Window over | clock 10 min later | sign-in accepted, count restarts at 0 | — |
| Successful sign-ins | any number | never counted | — |

</frozen-after-approval>

## Code Map

- `packages/api/src/app.ts` -- `createApp`: mount the body limit and the ceiling middleware; `.on(["GET","POST"], "/api/auth/*")` stays the handler. The ceiling middleware sits here beside the body limit; it takes `SIGN_IN_CEILING`, no `AppDeps` option.
- `packages/api/src/routes/accounts.ts:128` -- the upload's own `bodyLimit`; unchanged, and the path `except` skips.
- `packages/api/src/schemas/imports.ts:17` -- the `MAX_IMPORT_BYTES` comment about `ofx-js` slowing down becomes stale; say the patch fixed it and the cap stays for memory.
- `packages/api/src/lib/errors.ts` -- `PAYLOAD_TOO_LARGE: 413`; `TOO_MANY_REQUESTS: 429` exists since 13.1.
- `packages/api/src/services/auth.ts:101` -- `rateLimit`; the adapter `schema` map gains `rateLimits` (with `usePlural` the model `rateLimit` looks up that key; no rename trick as for `auth_accounts`).
- `packages/api/src/services/sign-in-failures.ts` (new), `.spec.ts` -- `reserveAttempt` (one upsert with `setWhere`, `null` when refused), `releaseAttempt`, `SIGN_IN_CEILING` `{ max, windowMs, now }`; specs pass smaller options to the service directly.
- `packages/api/src/connectors/ofx/ofx.ts:204` -- calls `parseSync(closeEmptyLeaves(...))`; `closeEmptyLeaves` is linear, leave it.
- `packages/api/src/connectors/ofx/ofx.spec.ts` -- adversarial inputs with a time budget.
- `packages/api/src/app.spec.ts:2515` -- `paddedOfx`, `upload`, `uploaded`: reuse for the upload rows.
- `packages/api/src/testing/auth.ts` -- `createTestAuth` for the restart case; the app-level specs use the default ceiling under a fake `Date`. Specs sign in once per file.
- `packages/data/schema/auth.ts`, `packages/data/drizzle/` -- two tables, one migration.
- `node_modules/.pnpm/ofx-js@1.1.1/node_modules/ofx-js/ofx.js` -- lines 1-12 (`sgml2Xml`) and 17 (comment strip): the patch target. `ofx.ts` beside it is not loaded (`main` is `./ofx.js`).
- `Dockerfile:10,24` -- the `COPY` lines before each install.
- `packages/app/src/locales/fr.json` -- `errors.PAYLOAD_TOO_LARGE`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/connectors/ofx/ofx.spec.ts` -- failing tests first: 40-character tags, 5 MB whitespace run, 5 MB of `<!--`, each under 1 s through `ofxSource`; plus an existing SGML fixture parsed identically.
- [x] `patches/ofx-js@1.1.1.patch`, `pnpm-workspace.yaml`, `Dockerfile`, `schemas/imports.ts` -- the patch, its registration, the image copy, the stale comment.
- [x] `packages/api/src/app.spec.ts`, `lib/errors.ts`, `app.ts`, `fr.json` -- body-limit rows as failing tests, then the middleware and code.
- [x] `packages/data/schema/auth.ts`, `packages/data/drizzle/*` -- both tables, `pnpm data generate`.
- [x] `packages/api/src/services/sign-in-failures.spec.ts`, `sign-in-failures.ts` -- window, ceiling, reset, restart on the same file.
- [x] `packages/api/src/app.spec.ts` or a new `services/auth.spec.ts`, `services/auth.ts`, `app.ts`, `testing/auth.ts` -- sign-in rows of the matrix, then the database storage and the ceiling middleware.

**Acceptance Criteria:**
- Given the finished story, when `pnpm test` runs, then every matrix row has a Vitest test.
- Given the patch, when the CI `image` job builds the container, then `pnpm install --frozen-lockfile` applies it and the job passes.
- Given the e2e run and its per-test `clientAddress`, when `pnpm test:e2e` runs, then it passes: its one wrong-password test stays far below the ceiling.

## Implementation Notes

- The matrix's `POST /api/transactions` does not exist; the over-limit JSON rows use `POST /api/accounts/:id/transactions`, the route that creates a transaction, so "nothing written" is checked on a real write path.
- In process, `app.request` sends no `Content-Length`, so the "declared length" row sets the header explicitly on a stream body and checks the stream was not read.
- Better Auth's memory store is a module-level map shared by every instance in one process, so a new `createAuth` alone would pass the restart row with memory storage too. `services/auth.spec.ts` also asserts the count sits in `rate_limits`.
- `SIGN_IN_CEILING.now` is `() => Date.now()`, not `Date.now`: a captured reference escapes a spec's fake clock.
- The tag-based adversarial rows (`<A` repeated, one long attribute name) run at 1 MB, not 5 MB: tags are real work, about 70 ms per MB, and 5 MB under coverage on a loaded runner took 1.2 s. At 1 MB a quadratic parser would still take about 25 s.
- After the spec review, `AppDeps.signInCeiling` and the sixth argument of `buildTestApp` were removed: only a test of that wiring used them. `errors.TOO_MANY_REQUESTS` now reads « Réessayez un peu plus tard », like `signIn.tooManyAttempts`.
- The existing SGML fixture and a sample with dotted tags, whitespace and comments are pinned by inline snapshots written by the unpatched library before the patch was applied.

## Spec Change Log

- Loop 1. Trigger: review found (a) `parseXmlString` in `ofx-js` still quadratic through its unanchored `match(/([\w:-]+)\s*=…/)` in `attribute()` and `match(/\??>\s*/)` / `match(/\?>\s*/)`: `"<OFX>" + "<A".repeat(n) + "</OFX>"` took 1 s at 40 KB; (b) the ceiling checked before and counted after the handler, so a burst of N parallel attempts from N addresses all passed while the count sat below 20. Amended: Design Notes (reservation, anchoring). Known-bad state avoided: a 5 MB upload holding the server for hours; a ceiling that bounds an attacker's concurrency instead of their guesses. KEEP: the body limit and its tests, the database storage of Better Auth and its restart test, the single-row table, the three original regex rewrites and both inline snapshots, the Dockerfile copy. Code was amended in place rather than reverted: the defects sit in two functions and one patch file.

## Review Triage Log

| Finding | Verdict | Evidence | Route |
|---|---|---|---|
| `parseXmlString` still quadratic through unanchored `match()` in `attribute()` and `\??>` (blind, edge, edge claim) | high | Measured by two reviewers: 40 KB of `<A` takes 1 s through `ofxSource.parse`, quadrupling per doubling; the regex at `ofx.js:69` is unanchored. | bad_spec (loop 1) |
| Ceiling checked before and counted after the handler: a parallel burst passes (blind, edge) | high | `isOverCeiling` reads, the handler runs, `countFailure` writes; N concurrent attempts all read 19. Per-address limit still applies, so 1,000 addresses get 1,000 guesses per window. | bad_spec (loop 1) |
| `countFailure` throwing after `next()` turns a 401 into a 500 (blind, edge) | medium | `app.onError` maps any throw to `INTERNAL_ERROR`; the sign-in page then shows a server error for a wrong password. | patch |
| `signIn.tooManyAttempts` says « quelques secondes » while the ceiling blocks up to 10 minutes (blind, verification) | medium | `sign-in.tsx:93` maps every 429 to that text. The page itself needs no change, only the sentence. | patch |
| Dockerfile comment « The install applies them » has no referent (blind) | low | Direct rewording. | patch |
| Clock moved back leaves `window_started_at` in the future (edge) | low | The lock lasts at most the jump plus 10 minutes; a guard adds a branch for a rare event. | rejected |
| `rate_limits` grows without bound from random `/api/auth` paths (edge) | false | Better Auth deletes rows older than 60 s whenever any key's window resets (`deleteExpiredRows`); growth is bounded by request rate times a minute. | rejected |
| A schema-valid rule of 50 groups of 50 conditions exceeds 64 KB (edge) | low | Nobody builds 2,500 conditions through the interface; the 413 names the cause. | rejected |
| A near-64,000-character private key with escapes exceeds 64 KB (blind) | low | About 65,100 bytes at the schema's maximum, under 65,536; a real key is 3 KB. | rejected |
| `PAYLOAD_TOO_LARGE` text advises shortening typed text (blind) | low | No interface form can send 64 KB except by typing; a key file that large is not a key. | rejected |
| Owner locked out has no way out; `reset-password` does not clear the ceiling (blind) | low | Waiting 10 minutes is the way out; Story 13.7's guide documents it, per the epic. | rejected |
| 413 and ceiling 429 on `/api/auth/*` use Archant's envelope, not Better Auth's shape (blind) | low | The interface reads only `error.status` there; Better Auth's own responses are unchanged, which is what the constraint protects. | rejected |
| Spec `in-review` while sprint status says `in-progress` (blind) | false | The workflow syncs sprint status at presentation. | rejected |
| Wall-clock 1 s asserts on 5 MB uploads may flake in CI (blind) | maybe-false | Settled by the timings of the full run; kept unless they approach the budget. | rejected |
| No snapshot pins an unclosed `<!--` before a closed comment (blind) | false | If a later `-->` exists, the earlier `<!--` is not unclosed: both regex and loop stop at the same first `-->`. | rejected |
| `buildTestApp` has six positional arguments (blind) | low | Matches the helper's existing style; readability only. | rejected |
| `docs/tech-stack.md` table realigned whole (blind) | false | `pnpm format` realigns Markdown tables. | rejected |
| No `CHECK (id = 'all')` on `sign_in_failures` (blind) | low | Only the service writes it, with a constant id. | rejected |

## Design Notes

Why count failures and not attempts: counted before Better Auth, one address sending a thousand requests would spend the ceiling alone and lock the owner out. A failure needs Better Auth to have let the attempt through, so one address burns at most three per 10 s.

Reservation, not check-then-count: before the handler, one upsert takes a slot (`count + 1`) only when the window is over or `count < max`, returning the row; no row back means refused. After the handler, any status but `401` gives the slot back (`count - 1` on the same window). A burst cannot pass more than `max` attempts to Better Auth. Writes after the handler are wrapped: a failed write is logged and the handler's response stands.

Every unanchored `match()` of `parseXmlString` is anchored with `^`. On any file a bank emits these matches already sit at index 0; unanchored, `match` then slices `m[0].length` from the start anyway, so a match elsewhere only ever produced garbage.

Why a table of our own for the ceiling: Better Auth prunes its `rate_limits` rows older than its longest window, 60 s, which would reset a 10-minute count. Its key is `ip|path`, so ours could never collide, but the pruning could.

Cost accepted: with database storage every `/api/auth/*` call, including the `get-session` of each page load, writes one row. Negligible on a local SQLite file.

Trade-off accepted: during a distributed guess the owner cannot sign in either; open sessions keep working for seven days. Story 13.7's guide says so.

Sure has no overall ceiling (its `rack_attack.rb` limits per address only); the epic asks for one.

## Verification

**Commands:**
- `pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint:code && pnpm test` -- expected: green.
- `pnpm test:e2e` -- expected: green.
- `BETTER_AUTH_SECRET=... docker compose up --build --detach --wait` -- expected: healthy, the patch applied in the image.

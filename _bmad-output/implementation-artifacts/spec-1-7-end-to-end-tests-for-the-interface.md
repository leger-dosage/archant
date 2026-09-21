---
title: 'Story 1.7: End-to-end tests for the interface'
type: 'chore'
created: '2026-09-21'
status: 'done'
baseline_commit: '442f4722f2e76a0b64279471848202f9b0d444a3'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/scaffolding-lessons.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-archant-2026-09-21/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Stories 1.1 to 1.4 were checked in a browser by throwaway scripts; the web package tests `lib/` only, `pnpm test:e2e` calls a script that does not exist, and no GitHub Actions workflow runs the gate that `AGENTS.md` says runs on every pull request. Reverting a route's search params or a dialog's delete passes every test today.

**Approach:** Add Playwright to `@archant/web` with a harness that starts the API on a fresh migrated SQLite file and serves the built interface, then cover every interface criterion of Stories 1.1 to 1.4, unit-test `unwrap`, and add the CI workflow running the gate and the end-to-end suite.

## Boundaries & Constraints

**Always:**
- Spine AD-16 (no test reaches the network; Playwright with `forbidOnly` in CI and no reused server) and `scaffolding-lessons.md` bind: a temporary file, never `:memory:`.
- `pnpm test:e2e` works on a clean checkout after `pnpm --filter @archant/web exec playwright install chromium`, and while the dev servers run: the suite uses its own ports, API `8788` and interface `4174`. The API reads a new `PORT` (default `8787`), listed in `.env.example`; `vite.config.ts` proxies `/api` to `localhost:${PORT ?? 8787}`.
- The interface is served by `vite build` then `vite preview --strictPort`: the suite tests the bundle that ships.
- One database per run, migrated with `runMigrations` from `@archant/data/migrate`, removed on exit. `workers: 1`. Each test creates its own accounts with unique names and asserts on its own rows; shared figures (group totals, sidebar) are asserted as a change around the action.
- Browser context: locale `fr-FR`, `timezoneId: "Europe/Paris"`, the API started with `APP_TIMEZONE=Europe/Paris`. Dates are computed relative to today in that zone.
- A fixture used by every test aborts any request whose host is not `localhost` and fails the test naming the URL.
- Setup data goes through the API (`request` fixture); the flow under test goes through the interface, by role and accessible name, never by CSS class.
- A criterion already covered by Vitest (stored minor units, `opening_anchor`, `404`/`500` envelopes, recompute range, carried balances, branch coverage) is not duplicated in Playwright; the audit task confirms each has a test.

**Never:**
- No component-test harness (jsdom, Testing Library), no visual snapshots, no Firefox or WebKit, no test-only API route or reset endpoint, no container job.
- No change to application behaviour beyond `PORT`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Clean run | Dev API on `8787` running | Suite passes on `8788`, dev database untouched | — |
| Port taken | Something on `8788` | Playwright stops before any test | Names the port |
| Forgotten `.only` | `CI=1` | Run fails | `forbidOnly` |
| Outside request | A page loads `https://example.com/x.js` | Test fails | Message names the URL |
| `unwrap` | 400 with fields; unknown code; HTML body; rejected fetch | `ApiError` with fields; `INTERNAL_ERROR`; `NETWORK_ERROR`; `NETWORK_ERROR` | — |

</frozen-after-approval>

## Code Map

- `git show bb0b0ca:packages/web/playwright.config.ts`, `git show bb0b0ca:.github/workflows/ci.yml` -- abandoned scaffolding to start from. Drop its `:memory:` database, `WEB_ORIGIN`, `VITE_API_URL`, `/health` and the `image` job; keep `forbidOnly`, the gate matrix, `concurrency`, the browser install and the report upload on failure.
- `packages/api/src/index.ts` -- `PORT = 8787` hard-coded (L10); read it from `validateEnv`. `packages/api/src/env.ts` -- add `PORT: z.coerce.number().int().default(8787)`.
- `packages/web/vite.config.ts` -- `API_TARGET` (L7) used by `server.proxy` and `preview.proxy`.
- `packages/data/migrate.ts` -- `runMigrations(url)` (L14), importable without side effects.
- `packages/web/src/lib/api.ts` -- `unwrap` (L55) takes a promise of `{ ok, json }`; test with plain objects, no network.
- `packages/web/tsconfig.json` -- `include` lacks `e2e/**/*.ts`.
- `package.json` -- `test:e2e` already calls `pnpm --filter @archant/web test:e2e`. `.gitignore` already ignores `playwright-report` and `test-results`.
- `packages/api/src/app.spec.ts`, `services/ledger.spec.ts`, `domain/balances/forward.spec.ts` -- where the Vitest-covered criteria live.
- Criteria to cover in the browser: `epics.md` Stories 1.1 to 1.4; accessible names and French strings in `packages/web/src/locales/fr.json`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/web/src/lib/api.spec.ts` (new) -- the four `unwrap` cases.
- [x] `packages/api/src/env.ts`, `index.ts`, `.env.example`, `packages/web/vite.config.ts` -- `PORT`, with a why-comment on the shared variable.
- [x] `packages/web/package.json`, `playwright.config.ts` (new), `tsconfig.json` -- `@playwright/test`, script `test:e2e`, two `webServer` entries without `reuseExistingServer`, `workers: 1`, `forbidOnly` in CI, locale and time zone.
- [x] `packages/web/e2e/start-api.ts` (new) -- temp directory, `runMigrations`, spawn `packages/api/src/index.ts` with `DATABASE_URL`, `PORT=8788`, `APP_TIMEZONE`, `LOG_LEVEL=warn`; remove the directory when the process exits.
- [x] `packages/web/e2e/fixtures.ts` (new) -- `test` extended with the outside-request guard and API helpers `openAccount`, `addTransaction`, `recordSnapshot`, unique names, `daysAgo(n)` in `Europe/Paris`.
- [x] `packages/web/e2e/accounts.spec.ts` (new) -- Story 1.1: empty state (route-fulfilled empty list), create through the form with `1 234,56` shown as `1 234,56 €` under its group and in the sidebar, group totals change, assets versus liabilities, field errors next to the field, light and dark theme switch.
- [x] `packages/web/e2e/transactions.spec.ts` (new) -- Story 1.2: add, edit, delete with confirmation, header balance following each; `Esc` with changes asks to discard, `⌘Enter` saves; a date on the opening date shows the field error; card purchase `-30,00` raises the outstanding balance by `30,00 €`; pagination at 51 rows.
- [x] `packages/web/e2e/balance-history.spec.ts` (new) -- Story 1.3: each period selects, text summary present, « Voir les données » shows the table, unknown `period` falls back to `1M`, `period` kept across pagination links.
- [x] `packages/web/e2e/snapshots.spec.ts` (new) -- Story 1.4: `?tab=snapshots` selects Soldes, empty state, record with header and gap, replace on the same date, edit, delete after confirmation, a transaction on a snapshot day moves the gap only.
- [x] Audit -- for each Vitest-covered criterion of Stories 1.1 to 1.4, name its test in Implementation Notes; add any missing one in the matching spec file.
- [x] `.github/workflows/ci.yml` (new) -- on pull request and push to `main`: gate matrix (`lint:code`, `lint:format`, `typecheck`, `test`) and a `test:e2e` job on Node 24 installing Chromium with its dependencies.
- [x] `AGENTS.md` -- add `pnpm test:e2e` to the verification gate and the one-time `pnpm --filter @archant/web exec playwright install chromium` to the Testing section.

**Acceptance Criteria:**
- Given the finished story, when the gate and `pnpm test:e2e` run locally, then both pass and no tracked file is modified.
- Given any one of these reverted: the `.catch` on `period`, the `search` updater of a pagination link, the `tab` search param, the snapshot delete call, the `Esc` discard prompt, then at least one end-to-end test fails.
- Given a pull request, when GitHub Actions runs, then the gate jobs and `test:e2e` report separately.

## Implementation Notes

Audit of the Vitest-covered criteria of Stories 1.1 to 1.4 (no test was missing, none added):

| Criterion | Test |
| --- | --- |
| Account stored in `EUR`, `opening_anchor` of `123456` at its date | `app.spec.ts` › POST /api/accounts › "creates a checking account with its opening balance"; `ledger.spec.ts` › createAccount › "stores the account, one opening anchor and a balance for every day up to today" |
| `400 VALIDATION_ERROR` for an empty name, an unparsable amount, an unknown currency | `app.spec.ts` › POST /api/accounts › "rejects a blank name with its field code", "rejects the amount %j in %s", "rejects an unknown currency", "reports every invalid field at once" |
| `404 NOT_FOUND` on an unknown route, `500 INTERNAL_ERROR` without a stack | `app.spec.ts` › errors › "answers an unknown route with NOT_FOUND", "hides an unexpected failure behind INTERNAL_ERROR and logs its name and path only" |
| `-42,90` stored as `-4290` in the account's currency | `app.spec.ts` › POST /api/accounts/:id/transactions › "records an expense in the account's currency and moves the balance" |
| A date on or before the opening date refused with `VALIDATION_ERROR` | `app.spec.ts` › "refuses a transaction dated %s, on or before the opening date", PATCH › "refuses a move onto the opening date"; `ledger.spec.ts` › ingest › "rejects lines on or before the opening day, too far ahead or in another currency" |
| Card purchase raises the amount owed | `app.spec.ts` › "raises a card's amount owed on a purchase"; `ledger.spec.ts` › ingest › same name |
| Recompute from the earliest affected date to `max(today, latest entry)`, in the same transaction | `ledger.spec.ts` › ingest › "records an expense and recomputes the balance from its date", "extends the history to a transaction dated after today", "leaves no row behind when the recompute fails"; updateTransaction › "moves and changes a transaction, recomputing from the earlier date…", "drops the rows past the new end…"; deleteTransaction › "deletes the rows past the new end after removing the latest entry" |
| A day without transactions carries the previous balance | `forward.spec.ts` › "carries the previous balance over a day without movement"; `history.spec.ts` › fillDays › "carries a row from before the range over every day without one" |
| Branch coverage: opening date at exactly the opening balance, several on one day, a liability | `vitest.config.ts` thresholds (100 % on `domain/**` and `services/ledger.ts`); `forward.spec.ts` › "keeps the anchor day at exactly the anchor…", "adds several movements of one day together on an asset", "raises a liability's amount owed when money leaves it" |
| Snapshot fixes the day at exactly its balance, later days continue from it | `app.spec.ts` › POST /api/accounts/:id/snapshots › "pins the balance on its date; the next day continues from it"; `ledger.spec.ts` › recordSnapshot › "fixes the day's balance and the next days continue from it" |
| A second snapshot on the same date replaces the first | `app.spec.ts` › "replaces the snapshot of the same date, keeping its id" |
| Editing or deleting a snapshot recomputes from its date | `app.spec.ts` › PATCH /api/snapshots/:id › "moves a snapshot earlier and recomputes from the new date"; DELETE › "deletes the snapshot and the balances follow the transactions again" |

Harness: `playwright.config.ts` starts `e2e/start-api.ts` (temporary directory, `runMigrations`, then the API entrypoint as a child process; the directory is removed when the child exits, and `gracefulShutdown: SIGTERM` gives it the time to) and `vite build && vite preview --port 4174 --strictPort` with `PORT=8788` as the proxy target. `vite.config.ts` reads `PORT` through `loadEnv` from the repository root, so a `PORT` set in `.env` moves the API and the proxy together. The API web server is awaited by `port`, so a taken `8788` stops the run with "http://localhost:8788 is already used".

Second acceptance criterion, checked by hand: reverting the `.catch` on `period` fails "an unknown period in the URL falls back to one month"; the pagination link's `search` updater, "the period is kept across the pages of the transactions"; the snapshot delete call, "a snapshot is edited, then deleted after confirmation"; the `Esc` prompt, "Esc asks before discarding unsaved changes…"; the `tab` param, replaced by an uncontrolled `Tabs defaultValue`, fails the four snapshot tests. Dropping only `tab` from the Zod search schema fails nothing: TanStack Router still hands the unvalidated key to `useSearch`, so the page keeps working.

Also checked: `CI=1` with a `test.only` fails on `forbidOnly`; a page loading `https://example.com/x.js` fails with "Requests outside localhost: https://example.com/x.js"; the suite passes with a dev API on `8787`, whose database is unchanged; `--repeat-each 3` passes.

## Spec Change Log

## Review Triage Log

| # | Source | Location | Finding | Verdict | Evidence | Route |
|---|--------|----------|---------|---------|----------|-------|
| 1 | blind, edge, verification | `vite.config.ts` `loadEnv` | Empty prefix loads every root `.env` variable into Vite; `PORT=` empty gives `http://localhost:` while the API falls back to 8787 | medium | Destructuring defaults only `undefined`; `.env.example` already ships empty values. | patch |
| 2 | blind, edge | `e2e/fixtures.ts` `addDailyTransactions` | 51 concurrent `immediate` writes queue on the 5 s busy timeout; relies on `this` | medium | Each POST recomputes balances in its own write transaction; a slow runner can exceed the timeout. | patch |
| 3 | blind | `ci.yml` | No `permissions:` block | medium | The token keeps the repository default on pushes to `main`; `contents: read` is all the jobs need. | patch |
| 4 | blind | `ci.yml` | Nothing checks that the gate leaves tracked files untouched | medium | `vite build` regenerates the tracked `routeTree.gen.ts`; AGENTS.md forbids a change after the gate. | patch |
| 5 | blind | `ci.yml`, `playwright.config.ts` | No job timeout | low | A hung server holds the runner for six hours; one line per job. | patch |
| 6 | edge | `ci.yml` `concurrency` | Pushes to `main` cancel each other | low | The earlier `main` commit gets no verdict; one expression. | patch |
| 7 | blind, edge | `e2e/start-api.ts` | Port and zone hard-coded beside `settings.ts` | low | Two sources for the same values; direct import. | patch |
| 8 | blind, edge | `e2e/start-api.ts` exit | Any signal death reported as a clean stop | low | An OOM kill of the API would exit 0; a flag set by the forwarded handlers fixes it. | patch |
| 9 | blind | `accounts.spec.ts` | Variable `checking` holds a savings account | low | Misleading name; rename. | patch |
| 10 | blind | `sprint-status.yaml` | `last_updated` moves backwards; status `in-progress` versus spec `in-review` | false | The previous value was ahead of the system clock; step 5 sets both files to their final status. |  |
| 11 | blind, edge | `e2e/start-api.ts` | Temporary directory leaks when migrations fail or a signal arrives before the handlers | low | Needs a failing migration or a stop within the first second; adds branches. Rejected. |  |
| 12 | edge | `playwright.config.ts` `gracefulShutdown` | Directory leaks if the API takes over 5 s to stop | low | The API stops in milliseconds; rejected. |  |
| 13 | blind, edge | `e2e/fixtures.ts` `daysAgo` | Browser, test and API may disagree on today across midnight in Paris | low | The suite runs in about 16 s; the window is seconds a day. Rejected. |  |
| 14 | blind, edge | `e2e/fixtures.ts` guard | WebSockets bypass `context.route` | low | The preview server opens none and the app has no socket; rejected. |  |
| 15 | edge | `e2e/fixtures.ts` guard | `127.0.0.1` treated as outside | false | The interface calls only relative `/api` URLs on `localhost`. |  |
| 16 | edge | `accounts.spec.ts`, `transactions.spec.ts` | Unescaped names in `RegExp` | false | Every name comes from `uniqueName` or a literal without metacharacters. |  |
| 17 | blind, edge | `snapshots.spec.ts` | Dropping `tab` from the Zod search schema fails no test | false | The page keeps working, so no user-visible regression goes unseen; the controlled-tabs revert fails four tests. |  |
| 18 | blind | `accounts.spec.ts` theme | System mode not covered | low | Not in Story 1.1's criteria; rejected. |  |
| 19 | blind | `env.spec.ts` | No non-numeric `PORT` case | low | `z.coerce.number()` rejects it; the range case already proves the error names `PORT`. Rejected. |  |
| 20 | blind | `ci.yml` | Chromium downloaded on every run | low | About 30 s per run; rejected. |  |
| 21 | blind | `ci.yml` | Actions pinned by tag, not SHA | low | Official `actions/*` and `pnpm/*`; rejected. |  |
| 22 | verification | `vite.config.ts` | Reading `PORT` from the root `.env` file is never exercised | medium | The suite passes `PORT` through `process.env`, which `loadEnv` overlays. | defer |
| 23 | verification | `vite.config.ts` | `.env.local` moves the proxy but not the API | low | `.env.*` is git-ignored and undocumented; rejected. |  |
| 24 | verification | `.env.example` | `BETTER_AUTH_URL` keeps `8787` | low | No code reads it before Epic 3; rejected. |  |

## Design Notes

`@playwright/test` is the one new dependency; AGENTS.md already names Playwright, and the pull request states the reason.

The API keeps its default port so no developer setup changes; only the suite sets `PORT`. Vite reads the same variable for its proxy target because it names the API's port in both processes, and Vite's own port is passed as a flag.

`workers: 1` trades speed for a single SQLite writer and assertions on shared totals that hold; the suite has about twenty tests.

## Verification

**Commands:**
- `pnpm install --frozen-lockfile && pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test && pnpm test:e2e` -- all pass, `git status` clean afterwards.
- `pnpm api start:dev` running, then `pnpm test:e2e` -- passes; `local.db` unchanged.

**Manual checks:**
- Revert each item of the second acceptance criterion in turn and watch the suite fail, then restore.

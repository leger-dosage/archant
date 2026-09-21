---
title: 'Story 1.7: End-to-end tests for the interface'
type: 'chore'
created: '2026-09-21'
status: 'ready-for-dev'
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
- [ ] `packages/web/src/lib/api.spec.ts` (new) -- the four `unwrap` cases.
- [ ] `packages/api/src/env.ts`, `index.ts`, `.env.example`, `packages/web/vite.config.ts` -- `PORT`, with a why-comment on the shared variable.
- [ ] `packages/web/package.json`, `playwright.config.ts` (new), `tsconfig.json` -- `@playwright/test`, script `test:e2e`, two `webServer` entries without `reuseExistingServer`, `workers: 1`, `forbidOnly` in CI, locale and time zone.
- [ ] `packages/web/e2e/start-api.ts` (new) -- temp directory, `runMigrations`, spawn `packages/api/src/index.ts` with `DATABASE_URL`, `PORT=8788`, `APP_TIMEZONE`, `LOG_LEVEL=warn`; remove the directory when the process exits.
- [ ] `packages/web/e2e/fixtures.ts` (new) -- `test` extended with the outside-request guard and API helpers `openAccount`, `addTransaction`, `recordSnapshot`, unique names, `daysAgo(n)` in `Europe/Paris`.
- [ ] `packages/web/e2e/accounts.spec.ts` (new) -- Story 1.1: empty state (route-fulfilled empty list), create through the form with `1 234,56` shown as `1 234,56 €` under its group and in the sidebar, group totals change, assets versus liabilities, field errors next to the field, light and dark theme switch.
- [ ] `packages/web/e2e/transactions.spec.ts` (new) -- Story 1.2: add, edit, delete with confirmation, header balance following each; `Esc` with changes asks to discard, `⌘Enter` saves; a date on the opening date shows the field error; card purchase `-30,00` raises the outstanding balance by `30,00 €`; pagination at 51 rows.
- [ ] `packages/web/e2e/balance-history.spec.ts` (new) -- Story 1.3: each period selects, text summary present, « Voir les données » shows the table, unknown `period` falls back to `1M`, `period` kept across pagination links.
- [ ] `packages/web/e2e/snapshots.spec.ts` (new) -- Story 1.4: `?tab=snapshots` selects Soldes, empty state, record with header and gap, replace on the same date, edit, delete after confirmation, a transaction on a snapshot day moves the gap only.
- [ ] Audit -- for each Vitest-covered criterion of Stories 1.1 to 1.4, name its test in Implementation Notes; add any missing one in the matching spec file.
- [ ] `.github/workflows/ci.yml` (new) -- on pull request and push to `main`: gate matrix (`lint:code`, `lint:format`, `typecheck`, `test`) and a `test:e2e` job on Node 24 installing Chromium with its dependencies.
- [ ] `AGENTS.md` -- add `pnpm test:e2e` to the verification gate and the one-time `pnpm --filter @archant/web exec playwright install chromium` to the Testing section.

**Acceptance Criteria:**
- Given the finished story, when the gate and `pnpm test:e2e` run locally, then both pass and no tracked file is modified.
- Given any one of these reverted: the `.catch` on `period`, the `search` updater of a pagination link, the `tab` search param, the snapshot delete call, the `Esc` discard prompt, then at least one end-to-end test fails.
- Given a pull request, when GitHub Actions runs, then the gate jobs and `test:e2e` report separately.

## Implementation Notes

## Spec Change Log

## Review Triage Log

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

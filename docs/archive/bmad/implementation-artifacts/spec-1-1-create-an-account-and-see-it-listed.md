---
title: 'Story 1.1: Create an account and see it listed'
type: 'feature'
created: '2026-09-21'
status: 'done'
baseline_commit: '5fb8d2d07fe0f72e8d3dcd19c8373857585fa50e'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/scaffolding-lessons.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-archant-2026-09-21/ARCHITECTURE-SPINE.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-archant-2026-09-21/DESIGN.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-archant-2026-09-21/EXPERIENCE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The repository has a toolchain and a plan but no package, so nothing runs. The household cannot record a single account, and every later story needs the packages, the ledger and the app shell this story lays down.

**Approach:** Create `@archant/data`, `@archant/api` and `@archant/web` with only the dependencies this story uses. A user creates a depository (checking or savings) or credit card account with an opening balance at a date; the ledger stores it with its `opening_anchor` valuation and its daily balances, and `/comptes` plus the sidebar list accounts under Actifs and Passifs with totals, in the brand layer, in French.

## Boundaries & Constraints

**Always:**
- Architecture spine AD-1, AD-2, AD-5, AD-6, AD-8, AD-15, AD-16 and its Consistency Conventions bind; `scaffolding-lessons.md` pitfalls apply.
- Opening balance is a stored balance (AD-5): an asset's value, a card's amount owed, entered as a positive number; a negative is accepted (overdrawn account, card in credit). No Dépense / Revenu toggle on it.
- One "Type" choice in the form with three options: Compte courant (`depository`/`checking`), Épargne (`depository`/`savings`), Carte de crédit (`credit_card`, subtype null).
- Currency defaults to `EUR`, chosen from the static ISO 4217 table. Opening date defaults to today in the browser, is required, and any valid date is accepted.
- Request schemas take the amount as text and parse it with `parseAmount` using the currency's minor units, so the form (react-hook-form resolver) and the API reject the same inputs with the same field codes.
- Group totals sum only accounts in the reporting currency (`EUR` through `getReportingCurrency()`), and each group reports how many accounts it left out.
- Validation failures answer `400 VALIDATION_ERROR` with `fields: { path, code }[]`; the form shows `errors.fields.<code>` under the field. Other failures show a destructive Sonner toast with `errors.<CODE>`.
- Dark mode follows `prefers-color-scheme`; a Système / Clair / Sombre menu in the sidebar footer overrides it, stored in `localStorage`, applied before first paint.

**Never:**
- No sign-in, no transactions, no chart, no `/comptes/:id` page: account rows are not links until Story 1.2. No nav entry for unshipped epics.
- No credit card detail fields (limit, APR), no institution, no deactivate or exclude flags, no `settings` table, no start-time migrations, no container, no Playwright, no CI workflow.
- No CORS, no `VITE_API_URL`: the interface calls the relative `/api`, proxied by Vite.
- `onError` never logs an error message or stack: Drizzle query errors embed parameter values, which are amounts.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Create checking | `Compte joint`, Compte courant, EUR, `1 234,56`, 2026-09-01 | `201`, account with `currency: "EUR"`; one `opening_anchor` entry of `123456` on 2026-09-01; `balances` rows from that date to today, each `123456` | — |
| Create card | Carte de crédit, `490,30` | Listed under Passifs as `490,30 €`, Passifs total `490,30 €` | — |
| Other currency | Compte courant in `USD`, `10.00` | Listed with `10,00 $US`; left out of Actifs total, group reports 1 left out | — |
| Empty name | `name: "  "` | `400 VALIDATION_ERROR`, `fields: [{ path: "name", code: "too_small" }]` | Message under the field |
| Bad amount | `12,3,4` or `1,234` for JPY | `400`, `fields: [{ path: "openingBalance", code: "invalid_amount" }]` | Message under the field |
| Unknown currency | `XYZ` | `400`, `fields: [{ path: "currency", code: "invalid_currency" }]` | Message under the field |
| Unknown route | `GET /api/nope` | `404 { error: { code: "NOT_FOUND" } }` | — |
| Unexpected throw | service throws `Error` | `500 { error: { code: "INTERNAL_ERROR" } }`, no stack in body | Logged with name and path only |

</frozen-after-approval>

## Code Map

- `package.json`, `pnpm-workspace.yaml` -- root aliases `data`/`api`/`web` exist; add `onlyBuiltDependencies: [esbuild]` and catalog entries for `vitest`, `@types/node`; keep `--no-error-on-unmatched-pattern`.
- `.oxlintrc.json` -- add `overrides` with `no-restricted-imports`: `domain/**` bans `drizzle-orm`, `hono`, `services/**`; `packages/api/src/**` bans `@archant/data/schema/entries` and `@archant/data/schema/balances` except in `services/ledger.ts` (AD-1, AD-2).
- `.env.example` -- contradicts the lessons: `DATABASE_URL=file:./local.db` becomes `file:../../local.db`; drop `VITE_API_URL`; add `APP_TIMEZONE` and `LOG_LEVEL`.
- Commit `bb0b0ca` (read with `git show bb0b0ca:<path>`) -- reuse nearly verbatim: `packages/data/{client,migrate,drizzle.config}.ts`, `migrate.spec.ts` temp-file pattern, empty `drizzle/meta/_journal.json`, package `tsconfig.json`s, `node --env-file-if-exists=../../.env` scripts, `api/src/env.ts` shape, `notFound`/`onError` bodies. Do not reuse: CORS, `WEB_ORIGIN`, `VITE_API_URL`, `/health` without `/api`, `better-auth`, `422` for validation, the fetch stub (AD-16 wants msw).
- `~/github/sure/app/models/account/opening_balance_manager.rb` -- reference for the opening anchor: one valuation, amount is the balance, account currency.

## Tasks & Acceptance

**Execution:**
- [x] `pnpm-workspace.yaml`, `package.json`, `.oxlintrc.json`, `.env.example` -- changes listed in the Code Map -- toolchain first so each package lands green.
- [x] `packages/data/money.spec.ts`, `money.ts` -- tests first: `parseAmount` accepts `1234,56`, `1 234,56` (normal and narrow no-break spaces), `-42,90`, `42.90`, rejects extra decimals for the currency's minor units and anything else; `formatMoney` gives `1 234,56 €` with U+202F and a U+2212 minus. `MinorUnits` branded integer, ISO 4217 minor-unit table, `isCurrencyCode`.
- [x] `packages/data/account-types.ts` -- `ACCOUNT_TYPES` (`depository`: asset, `checking`/`savings`; `credit_card`: liability, no subtype), `ACCOUNT_TYPE_IDS`, `classificationOf`.
- [x] `packages/data/schema/{accounts,entries,balances}.ts`, `types.ts`, `client.ts`, `migrate.ts`, `drizzle/` -- `accounts (id, name, type, subtype, currency, created_at, updated_at)`; `entries (id, account_id, kind, valuation_kind, date, amount, currency, created_at, updated_at)` with check constraints from the const arrays and a partial unique index allowing one `opening_anchor` per account; `balances (account_id, date, balance, currency)` primary key `(account_id, date)`. `createDb` sets `foreign_keys`, and WAL and `busy_timeout` for `file:` URLs. Generate the migration; `migrate.spec.ts` migrates a temp file. `exports` map with subpaths only.
- [x] `packages/api/src/domain/dates.ts`, `domain/balances/forward.ts` + specs -- `today(timeZone)`, `addDays`, `forwardBalances(anchor, until)` returning one row per day from the anchor date to `max(until, anchor date)`. 100% branches.
- [x] `packages/api/src/lib/errors.ts`, `lib/zod-error.ts`, `lib/logger.ts`, `env.ts` + specs -- `AppError` with `NOT_FOUND 404`, `VALIDATION_ERROR 400`, `INTERNAL_ERROR 500`; one mapper from a Zod error to `fields`; pino with `redact` on `req.headers.authorization` and `req.headers.cookie`; `validateEnv` for `DATABASE_URL`, `DATABASE_AUTH_TOKEN`, `APP_TIMEZONE` (default `Europe/Paris`), `LOG_LEVEL`.
- [x] `packages/api/src/services/ledger.spec.ts`, `services/ledger.ts` -- `createAccount(input, { origin: "user" })` in one `behavior: "immediate"` transaction: account, opening anchor, balances; `balanceOn(accountId, date)`. Temp SQLite file per spec file.
- [x] `packages/api/src/services/accounts.ts`, `services/settings.ts` -- `listAccounts()` returns every account with `balanceOn(today)`, grouped `asset` then `liability`, sorted by name, each group with `total` in the reporting currency and `excludedCount`; `getReportingCurrency()` returns `EUR`.
- [x] `packages/api/src/schemas/accounts.ts`, `routes/accounts.ts`, `app.ts`, `index.ts`, `app.spec.ts`, `vitest.setup.ts` -- `POST /api/accounts` (201), `GET /api/accounts`, chained mounts, `AppType`, `notFound` and `onError`; `index.ts` serves on port 8787. Spec covers the I/O matrix through `app.request`. msw fails any unhandled request, naming the URL.
- [x] `packages/web/` -- Vite with `/api` proxy to 8787, React, TanStack Router file routes (`/` redirects to `/comptes`), TanStack Query with `queryKeys.accounts`, `lib/api.ts` = `hc<AppType>("/api")`, i18next with `locales/fr.json` only, Tailwind 4 theme from DESIGN.md tokens (`--accent-brand`, `--money-*` alongside shadcn neutral), Geist fonts, shadcn `button`, `dialog`, `input`, `label`, `select`, `popover`, `calendar`, `sidebar`, `sheet`, `skeleton`, `sonner`, `dropdown-menu`.
- [x] `packages/web/src/lib/form-errors.ts` + spec -- maps an API `fields` array onto react-hook-form errors; the one web test, in a node environment.
- [x] `packages/web/src/components/{Money,AppSidebar,ThemeMenu,AccountGroups,CreateAccountDialog}.tsx`, `routes/comptes.tsx` -- `Money` wraps `formatMoney`, balances unsigned and uncoloured; sidebar shows Comptes and the groups with totals, collapsible and remembered in `localStorage`, icons only below 1024 px without the account list, sheet below 768 px; empty state « Aucun compte pour l'instant. » with « Ajouter un compte »; skeleton while loading; dialog form with Nom, Type, Devise, Solde initial, Date du solde.
- [x] `docs/tech-stack.md`, `README.md` -- add the dependencies this story installs with their role; replace "nothing to run yet" with the four start commands.

**Acceptance Criteria:**
- Given a fresh clone, when `pnpm install --frozen-lockfile`, `pnpm data migrate:local`, `pnpm api start:dev` and `pnpm web start:dev` run, then `http://localhost:5173` opens on `/comptes` showing the empty state.
- Given the finished story, when the AGENTS.md verification gate runs, then every command passes and leaves no tracked file modified.
- Given any component, when it renders visible text, then that text comes from `fr.json`.
- Given the system in dark mode or the menu set to Sombre, when any page renders, then DESIGN.md dark tokens apply, and the choice survives a reload.

## Design Notes

`balances` is written from the first story so that `balanceOn` is the only way to read a balance (AD-8). With only an opening anchor, `forwardBalances` fills the anchor value from its date to today; Story 1.3 adds transaction amounts and the recompute on every write. The accounts endpoint returns the whole set, not a paged list: a household holds a bounded number of accounts, and the AD-15 paging rule targets entry lists.

## Verification

**Commands:**
- `pnpm install --frozen-lockfile && pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test` -- all pass, `git status` clean afterwards.
- `pnpm data migrate:local` -- creates `local.db` at the repository root.

**Manual checks:**
- Create one checking, one savings in USD and one card in the browser: groups, totals, the USD notice and French formatting match the I/O matrix, in light and dark mode, at 1280, 900 and 600 px wide.

## Implementation Notes

- `parseAmount(text, currency)` takes the currency, not a locale: the minor units decide which inputs are valid, and the accepted shapes (`1 234,56`, `42.90`, U+2212 minus) do not vary by locale yet.
- Custom Zod issues carry their field code as their message (`invalid_amount`, `invalid_currency`, `invalid_subtype`). `lib/zod-error.ts` on the API and `lib/form-errors.ts` on the web read it the same way, so a resolver error and an API error land on the same `errors.fields.<code>` key.
- The request schema checks the amount in a `superRefine`, so a blank name and a bad amount are reported together.
- `createDb` is async: it runs the pragmas. libSQL 0.18 pools connections; `busy_timeout` goes through the client's `timeout` option so every pooled connection gets it, and libSQL turns `foreign_keys` on per connection by default (checked in `client.spec.ts` inside a transaction).
- Check constraints spell out `is not null`: `null in (...)` is null, which a check lets through.
- `AppType` is the API sub-app mounted under `/api`, so `hc<AppType>("/api")` resolves `/api/accounts`, not `/api/api/accounts`.
- A malformed JSON body answers `400 VALIDATION_ERROR` without `fields`, rather than `500`.
- `balanceOn` returns `null` before the opening date; the list shows `0` for an account whose opening date is in the future.
- `routeTree.gen.ts` is committed and ignored by oxfmt and oxlint, so the router plugin can regenerate it during `pnpm test` without dirtying the tree.
- shadcn 4.21 (`radix-nova` preset) generates `cn` from the `cn` package instead of `clsx` + `tailwind-merge`, and its CSS imports `shadcn/tailwind.css`. Both kept. Vendored components were patched for `exactOptionalPropertyTypes`, lint (`no-shadow`, `curly`, needless casts), and their English screen-reader strings now come from `fr.json`. `sonner.tsx` reads Archant's theme store instead of `next-themes`.
- msw's `onUnhandledRequest` records the URL and calls `print.error()`: without it msw lets the request through to the network.

- Review patch, pending the owner's confirmation because it narrows the frozen "any valid date is accepted": `openingDate` must be on or after `1900-01-01` (`EARLIEST_OPENING_DATE`, field code `date_too_early`). A typo such as year `0026` otherwise wrote ~730k balance rows under the write lock.
- Review patch, same status: `parseAmount` refuses magnitudes above `MAX_MINOR_UNITS` (10^13). Without a cap, two huge balances overflow the list total and `GET /api/accounts` answers 500 until the database is edited.
- Balance chunks are inserted strictly in sequence through a promise chain, so a failed chunk never leaves another queued behind a rollback, with no lint suppression.
- The sidebar group total carries the "left out of the total" notice as its `title`; the accounts page shows it in full.
- `date-fns` is not a direct dependency: `react-day-picker` brings it, and no source file imports it.
- The QA pass used a throwaway Playwright script against a fresh database, because the preview panel could not capture screenshots.

## Spec Change Log

## Review Triage Log

| # | Source | Location | Finding | Verdict | Evidence | Route |
|---|--------|----------|---------|---------|----------|-------|
| 1 | blind, edge | `services/ledger.ts` | `Promise.all` over balance chunks can leave inserts queued after a rollback | medium | Drizzle rolls back on the first rejection while sibling promises are still pending on a remote libSQL stream. | patch |
| 2 | blind, edge | `schemas/accounts.ts` | No lower bound on `openingDate`; `0001-01-01` writes ~740k rows under the write lock | medium | `z.iso.date()` accepts year 1; `forwardBalances` loops day by day. A typo in the year reaches it. | patch |
| 3 | edge | `services/accounts.ts:76` | Sum of balances can exceed `MAX_SAFE_INTEGER`, then `toMinorUnits` throws on every `GET` | medium | `parseAmount` accepts any safe integer; two such accounts make the list answer 500 until the database is edited. | patch |
| 4 | blind, edge | `routes/comptes.tsx`, `AppSidebar.tsx` | A failed list query leaves the page with a title only and no retry | medium | `data` undefined and `isPending` false render nothing but the heading; the toast disappears. Sidebar vanishing is the same root cause and needs no own fix. | patch |
| 5 | edge, verification | `.oxlintrc.json` | The domain override drops the `entries`/`balances` import bans | medium | Verified by the reviewer with a probe file: `domain/` could import `@archant/data/schema/entries`. | patch |
| 6 | blind | `lib/api.ts`, `vite.config.ts` | Comments state the API serves the interface in production; `vite preview` has no proxy | low | `index.ts` serves no static files yet. Direct correction. | patch |
| 7 | blind, edge | `CreateAccountDialog.tsx`, `DateField.tsx` | Selects and date input lack `aria-describedby`; a stale Type error survives a change | low | Only the two `Input`s carry `describedBy`; `setValue` without `shouldValidate` keeps the old error. Accessibility floor of EXPERIENCE.md. | patch |
| 8 | blind, edge | `DateField.tsx`, `ThemeMenu.tsx`, `routes/comptes.tsx` | Visible text built outside `fr.json` | medium | Placeholder `jj/mm/aaaa`, ` : ` and `·` joins are literals; the story's acceptance criterion forbids it. | patch |
| 9 | edge | `lib/theme.ts:68-76` | `useResolvedTheme` does not re-render when the OS scheme changes under "system" | low | The store snapshot is `choice`, which stays `"system"`; Sonner keeps the old theme. Direct fix. | patch |
| 10 | blind, edge | `data/migrate.ts` | Client left open when `migrate` throws | low | `close()` only runs on success. Direct `finally`. | patch |
| 11 | blind, verification | `app.spec.ts:134` | `GET` test depends on data from a `POST` test | low | Shared temporary database; the test fails when run alone with `-t`. | patch |
| 12 | verification | `ledger.spec.ts:132` | Rollback test fails at the first insert, so it proves no atomicity | medium | Pre-verified gap: the subtype check rejects the account insert before any other write. | patch |
| 13 | verification | `services/accounts.ts:62` | `today` at the time-zone boundary and the future-opening `0` are untested on the list | medium | Pre-verified gap: clock frozen at 10:00Z, line 50 fallback uncovered. | patch |
| 14 | verification | `web/src/lib/dates.ts` | French date parsing has no test | medium | Pre-verified gap: a day/month swap would pass every check and misdate the opening anchor. | patch |
| 15 | verification | `web/src/lib/api.ts` | `unwrap` has no test | low | Pre-verified gap; the shared resolver makes the path rare. Filed as defer by the reviewer. | defer |
| 16 | blind, edge | `app.ts:44` | Other `HTTPException` statuses become 500 | false | No route or middleware raises one today: only malformed JSON does, and it is handled. |  |
| 17 | blind, edge | `env.ts:23` | `libsql://` URL accepted without a token | false | Self-hosted `sqld` serves `libsql://` without a token; the driver reports a missing one on first query. |  |
| 18 | blind | `vitest.config.ts` | No coverage threshold on `money.ts`, schemas, `services/accounts.ts` | false | AD-16 sets 100% on `domain/**`, `services/ledger.ts` and `connectors/**` only. |  |
| 19 | blind | `data`, `web` | msw guard only in `@archant/api` | low | No data or web test issues a request; adding msw to both adds a dependency for no reachable case. Rejected. |  |
| 20 | blind | root `package.json` | `test:e2e` calls a missing web script | false | Running it fails loudly, which is what AGENTS.md asks of a missing script; it is not in the gate. |  |
| 21 | blind | `hooks/use-mobile.ts` | Duplicate media-query hook, kebab-case name | low | Vendored by shadcn and imported by its `sidebar.tsx`; renaming breaks the next `shadcn add`. Rejected. |  |
| 22 | blind | `services/accounts.ts` | One `balanceOn` query per account | low | A household holds a bounded set of accounts; the Design Note already records it. Rejected. |  |
| 23 | blind, verification | review diff | Drizzle snapshot and route tree missing from the diff | false | Excluded from the review diff on purpose as generated files; both are in the working tree and will be committed. |  |
| 24 | edge | `CreateAccountDialog.tsx:52` | Browser ahead of `APP_TIMEZONE` defaults to the server's tomorrow, listed at 0 | low | Needs a browser and a server in different zones for one household; fix adds a server round trip. Rejected. |  |
| 25 | edge | `AccountGroups.tsx:26` | Group of foreign-currency accounts shows a `0,00 €` total | false | The group shows the "left out" notice next to it, as the spec requires. |  |
| 26 | edge | `Money.tsx:20` | Negative balances carry a minus | false | "Unsigned" means no `+`; an overdraft must read as negative. |  |

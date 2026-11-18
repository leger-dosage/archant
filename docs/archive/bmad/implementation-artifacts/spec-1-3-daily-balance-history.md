---
title: 'Story 1.3: Daily balance history'
type: 'feature'
created: '2026-09-21'
status: 'done'
baseline_commit: '9e621175d3747309bc835c1eba9cd3e461075bc9'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/scaffolding-lessons.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-archant-2026-09-21/ARCHITECTURE-SPINE.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-archant-2026-09-21/EXPERIENCE.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-archant-2026-09-21/DESIGN.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Archant stores an end-of-day balance for every day of every account, but shows only today's. The household cannot see how a balance moved over time.

**Approach:** Add `GET /api/accounts/:id/balances?period=` returning the stored daily balances of a period with its change, and a balance chart on `/comptes/$accountId` between the header and the transactions: a 1 M / 3 M / 6 M / 1 A / Tout segmented control, a text summary above, and a « Voir les données » table alternative (UX-DR5).

## Boundaries & Constraints

**Always:**
- Spine AD-2, AD-5, AD-8 and the Consistency Conventions bind; `scaffolding-lessons.md` pitfalls apply.
- Periods are `1M`, `3M`, `6M`, `1Y`, `all`, one `const` array shared by the API query schema and the web search param. Default `1M`, as Sure's `last_30_days`. The period lives in the `period` search param, not persisted elsewhere.
- The period ends today in `APP_TIMEZONE`. It starts at today minus 1, 3, 6 or 12 calendar months (day clamped to the month's end), or at the opening date for `all`, and never before the opening date. Balance rows after today, written for future-dated transactions, are not returned.
- One point per day of the period, read from `balances`; no downsampling. Values are stored balances (AD-5): a liability plots the amount owed, positive.
- The change is last point minus first point. Its percentage is `change / |first|`, and is `null` when the first point is zero, so the interface shows the amount alone, as Sure does.
- Summary above the chart: « Solde : 1 234,56 €, +12,40 € (+1,0 %) sur 1 mois. », « depuis l'ouverture » for `all`. Amounts through `formatMoney`, never coloured.
- Chart: shadcn `Chart` on recharts 3, one line in `--chart-1`, no fill, no grid except a faint baseline, tooltip with the French date and `Money`. Arrow keys move the tooltip cursor (recharts' accessibility layer). No animation.
- « Voir les données » is a button with `aria-expanded` that swaps the chart for a real table (Date, Solde, header cells), most recent day first, in a scrolling container. Loading shows a skeleton of the chart's height.

**Never:**
- No stat block colour, no tabs, no Soldes surface, no snapshot or gap display (Story 1.4), no net worth chart (Story 6.1).
- No change to the recompute or to `forwardBalances`: Story 1.2 already recomputes balances in every ledger write.
- No `@tanstack/react-table`: a static two-column table does not need it. No raw SQL.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| One month | Checking opened 2026-01-10; today 2026-09-21; `1M` | `from 2026-08-21`, `to 2026-09-21`, 32 points | — |
| Clipped | Opened 2026-09-01; `6M` | `from 2026-09-01`, first point is the opening balance | — |
| All | Opened 2024-02-29; `all` | `from 2024-02-29`, one point per day to today | — |
| Month-end clamp | Today 2026-03-31; `1M` | `from 2026-02-28` | — |
| Future transaction | Transaction on today + 10 days | Last point is today; the row on day + 10 is not returned | — |
| Liability | Card owing `490,30`, purchase `-30,00` today | Last point `52030`, change `+3000` | — |
| First point zero | Opening balance `0,00`, income `+100,00` | `change.amount 10000`, `change.percent null` | Summary shows the amount only |
| Opened in the future | Opening date after today | `points: []`, `change: null` | « Aucun solde sur cette période. » |
| Bad period | `?period=2W` | `400 VALIDATION_ERROR`, field `period` | — |
| Unknown account | `/api/accounts/nope/balances` | `404 NOT_FOUND` | Page already shows « Compte introuvable » |

</frozen-after-approval>

## Code Map

- `packages/api/src/services/ledger.ts` -- `lastBalanceOnOrBefore` (L47) is the only `balances` reader and returns one row; `.oxlintrc.json` bans `@archant/data/schema/balances` outside `ledger.ts`, so the range reader lives here next to `balanceOn` (L421) and `openingDateOf` (L432). Do not touch `recomputeBalances` (L67–137).
- `packages/data/schema/balances.ts` -- primary key `(account_id, date)` serves the range scan; no migration.
- `packages/api/src/domain/dates.ts` -- `today`, `addDays`, `maxDate`, `minDate`; no month arithmetic yet. `domain/**` and `services/ledger.ts` are held to 100% in `packages/api/vitest.config.ts`.
- `packages/api/src/services/accounts.ts` -- `getAccount` (L104) gives currency, `openingDate` and `NOT_FOUND`; reuse it.
- `packages/api/src/schemas/transactions.ts` -- `pageQuerySchema` (L103) is the query schema pattern; `routes/accounts.ts` `GET /:id/transactions` (L25) is the route pattern with `zValidator` and `validationError`.
- `packages/api/src/app.spec.ts` -- helpers `request`, `openAccount`, `postTransaction` (L224–248).
- `packages/web/src/routes/comptes.$accountId.tsx` -- `searchSchema` (L21) holds `page`; header L101–116, transactions section from L118.
- `packages/web/src/lib/query-keys.ts` -- a key under `accounts.detail(id)` is invalidated by `useInvalidateAccount` (`hooks/useTransactions.ts` L38) with no change there.
- `packages/web/src/styles.css` -- `--chart-1…6` tokens exist (L27–32, L91–96). `components/ui/` has no chart, toggle-group or table.
- `~/github/sure/app/models/period.rb`, `balance/chart_series_builder.rb`, `series.rb`, `trend.rb` -- reference for period ends, liability sign and the zero-start percentage.

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/domain/dates.spec.ts`, `dates.ts` -- tests first, then `addMonths(date, months)` clamping to the month's end, leap years included.
- [x] `packages/api/src/domain/balances/history.spec.ts`, `history.ts` (new) -- tests first, then `periodRange(period, today, openingDate)` returning `{ from, to }` or `null` when empty, and `balanceChange(points)` returning `{ amount, percent }` or `null`. 100% branches.
- [x] `packages/api/src/services/ledger.spec.ts`, `ledger.ts` -- `balancesBetween(deps, accountId, from, to)` ordered by date; add the ledger-level test for several transactions on one day that Story 1.2 left at the domain level only.
- [x] `packages/api/src/schemas/balances.ts` (new) -- `BALANCE_PERIODS` and `balanceQuerySchema` (`period`, default `1M`).
- [x] `packages/api/src/services/balances.ts` (new), `routes/accounts.ts`, `app.spec.ts` -- `getBalanceHistory(deps, accountId, period)` returning `{ period, from, to, currency, points: [{ date, balance }], change }`; route `GET /:id/balances`; spec covers the I/O matrix through `app.request`.
- [x] `packages/web/package.json`, `components/ui/{chart,toggle-group,table}.tsx` -- `pnpm dlx shadcn add chart toggle-group table`; recharts 3.10.1 and `react-is`, as pinned in the spine. Justify recharts in the pull request (NFR14).
- [x] `packages/web/src/lib/query-keys.ts`, `hooks/useBalanceHistory.ts` -- `accounts.balances(id, period)` = `["accounts", "detail", id, "balances", period]`.
- [x] `packages/web/src/components/BalanceChart.tsx`, `routes/comptes.$accountId.tsx`, `locales/fr.json` -- segmented control in a `role="group"` labelled « Période », summary, chart, table toggle, skeleton, empty state; `period` added to `searchSchema` with `.catch` to `1M`.

**Acceptance Criteria:**
- Given a saved, edited or deleted transaction, when the sheet closes, then the chart and its table show the new balance without a reload.
- Given the chart focused, when the arrow keys are pressed, then the tooltip moves day by day showing the date and the balance.
- Given `/comptes/<id>?period=3M` is opened directly, then 3 M is selected and the chart shows three months.
- Given the finished story, when the AGENTS.md verification gate runs, then every command passes and leaves no tracked file modified.

## Implementation Notes

- `periodRange` takes a month count or `"all"`, and `services/balances.ts` maps each `BalancePeriod` to it, so the domain imports nothing from `schemas/` (AD-1).
- `balances` rows stop at the last write's `max(today, latest entry)`; nothing extends them on quiet days. `balancesBetween` therefore reads the last row on or before `from` plus the rows in `(from, to]`, and `fillDays` (`domain/balances/history.ts`) carries the previous balance over every missing day, as `balanceOn` reads a single day. The chart's last point always equals the header balance.
- `change.percent` is in percentage points, one decimal, rounded on the absolute value so a rise and a fall of the same size round alike. `from` is `null` for an account opening after today.
- The period switch is Radix `ToggleGroup` in single mode: it renders a radio group labelled « Période » rather than the `role="group"` of the mockup, which is the right semantics for one choice among five.
- `period` in the page's search params is optional and defaults in the component, so a link without it stays clean and the default never lands in the URL. Pagination links keep the current period.
- Ticks switch to month and year past 200 points, so `1Y` and `all` show the year. A one-point series, an account opened today, draws its dot.
- Dark mode gets its own `--chart-1: #8098f9`, DESIGN.md's dark accent; the light indigo inherited before read at about 3:1 on the dark background.
- `components/ui/{chart,toggle-group,toggle,table}.tsx` vendored with the shadcn CLI and patched for oxlint (`no-shadow`, `eqeqeq`, typed recharts payload access), as in Story 1.1.
- Verified in Chromium on a throwaway database: a checking account opened 2026-06-01 with ten transactions, `?period=3M` selects 3 M and reads « Solde : 4 722,20 €, +3 342,20 € (+242,2 %) sur 3 mois. », which matches a hand computation; arrow keys show « dimanche 21 juin 2026 / 1 380,00 € »; « Voir les données » sets `aria-expanded` and lists 93 days; an account opened today shows its single point with no `period` in the URL; light and dark at 1280 px. 600 px was not checked.

## Spec Change Log

## Review Triage Log

| # | Source | Location | Finding | Verdict | Evidence | Route |
|---|--------|----------|---------|---------|----------|-------|
| 1 | blind, edge | `ledger.ts` `balancesBetween`, `services/balances.ts` | The series stops at the last write day; an idle account shows no point for `1M` | high | `recomputeBalances` extends rows only to `max(today at write time, latest entry)` and no read extends them; `balanceOn` hides this by taking the last row on or before. The frozen "one point per day" rule is broken on any quiet week. | patch |
| 2 | blind | `BalanceChart.tsx` `Summary` | Summary can disagree with the header balance | medium | Same root cause as #1: the header reads `balanceOn(today)`, the summary the last stored row. Fixed with #1. | patch |
| 3 | edge (claim) | `ledger.ts` docstring, `BalanceHistory.points` | "One row per day" and "today last" are false | medium | Same root cause as #1. | patch |
| 4 | blind, edge | `domain/balances/history.ts` `balanceChange` | `Math.round` rounds a negative half toward zero | low | -0.25 % gives -0.2, +0.25 % gives 0.3; direct fix. | patch |
| 5 | blind, edge | `BalanceChart.tsx` error branch | Alert and stale chart render together after a failed refetch | low | TanStack Query keeps `data` with `isError`; both blocks render. Direct fix. | patch |
| 6 | edge | `BalanceChart.tsx` `<Line dot={false}>` | One-point series draws nothing | medium | An account opened today, the create dialog's default, has one point; a line needs two. | patch |
| 7 | blind, edge (claim) | `BalanceChart.tsx` `LONG_RANGE_POINTS` | `1Y` ticks lack the year | low | 366 points is under the 400 threshold, so « 21 sept. » shows at both ends. Constant change. | patch |
| 8 | blind | `BalanceChart.tsx` `<LineChart>` | Arrow-key cursor relies on recharts' default | low | The AC depends on an unpinned default; one prop. | patch |
| 9 | verification | `lib/query-keys.ts` | No test that a transaction write invalidates the chart | medium | Pre-verified: no web test reads the keys; moving the key out of `detail(id)` passes every test. | patch |
| 10 | verification | `services/balances.ts` `today(deps.timeZone)` | Period end in `APP_TIMEZONE` untested | medium | Pre-verified: every balances test runs at 10:00 UTC, where UTC and Paris agree. | patch |
| 11 | verification | `comptes.$accountId.tsx` | `period` fallback and its survival across pagination untested | low | Pre-verified; the web package has no route or component test harness. | defer |
| 12 | blind, edge | `useBalanceHistory.ts` `placeholderData` | While a period loads, the toggle shows the new period and the summary the old one | low | The summary matches the line it describes; the gap lasts one request. Fixing it adds a loading branch. Rejected. |  |
| 13 | blind | `useBalanceHistory.ts` | `queryKey[2]` index guard is fragile | low | Same pattern as `useTransactions.ts` (Story 1.2 #3); no named caller diverges today. Rejected. |  |
| 14 | blind | web | No component tests for `BalanceChart` | low | AGENTS.md does not pad wiring with tests; the formatting logic lives in `lib/balance-change.ts`, covered. Rejected. |  |
| 15 | blind | `BalanceChart.tsx` | SVG has no label, `aria-controls` only when open, button label fixed | low | The text summary above and the table satisfy UX-DR5; the rest adds branches for no reported user. Rejected. |  |
| 16 | blind | `balance-change.ts` | A tiny change shows `+1,00 € (0,0 %)` | low | Sure shows the same rounding; cosmetic. Rejected. |  |
| 17 | blind | `packages/web/package.json` | `react-is` not on the catalog with React | false | recharts 3 declares `react-is` as `^16.8 \|\| ^17 \|\| ^18 \|\| ^19`, not an exact match; `^19.3.0` satisfies it. |  |
| 18 | blind | `components/ui/*` | Unused shadcn exports and `"use client"` | low | Vendored as generated, like every `ui/` file since Story 1.1. Rejected. |  |

## Design Notes

The first acceptance criterion of Story 1.3 in `epics.md`, the recompute in the same database transaction, shipped with Story 1.2 (see its Design Notes); `ledger.spec.ts` and `forward.spec.ts` already cover the opening day, gaps and liabilities. This story adds only the one missing ledger-level case.

Daily points over `all` stay small: ten years is 3 650 rows from one primary-key range scan, about 100 KB of JSON. Sure downsamples past one year; Archant follows the story's "each day" instead and can add it later without changing the response shape.

Before the opening date Sure plots zero; Archant starts the series at the opening date, since a zero line before the account existed reads as a real balance.

## Verification

**Commands:**
- `pnpm install --frozen-lockfile && pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test` -- all pass, coverage thresholds met, `git status` clean afterwards.

**Manual checks:**
- On a checking and a card account with transactions over several months: each period, the tooltip with the arrow keys, the table toggle, a transaction added then deleted moving the last point; light and dark, 1280 and 600 px.

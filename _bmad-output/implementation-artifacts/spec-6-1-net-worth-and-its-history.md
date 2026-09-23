---
title: 'Story 6.1: Net worth and its history'
type: 'feature'
created: '2026-09-23'
status: 'done'
baseline_commit: '1df1093cc4f5b7268d1f424c877e73557e9b9521'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-6-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/scaffolding-lessons.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Balances exist per account only; nothing tells the household where it stands overall or how that moved, and `/` still redirects to `/comptes` (FR34).

**Approach:** A dashboard at `/` shows net worth (assets minus liabilities), both totals, and a daily net worth chart over 1 M, 3 M, 6 M, 1 A or Tout with its change in amount and percentage, computed from the stored daily balances of active, reported, reporting-currency accounts; accounts left out for their currency are named in a notice.

## Boundaries & Constraints

**Always:**
- Counted accounts: `active`, not `excludedFromReports`, `currency === getReportingCurrency()`. The same set feeds the totals and every point of the series, so the headline equals the last point. Series accounts are today's set: an account deactivated or excluded later disappears from the whole history, since `accounts` has no deactivation date.
- Per counted account, `balancesBetween(deps, id, from, to)` gives one carried-forward point per day; a day before an account's opening date contributes nothing (Sure's `COALESCE(…, 0)`). A day before every counted account opened is omitted. Never sum `balances` rows by date in SQL: accounts' last rows have different dates.
- Net worth of a day = sum of asset points − sum of liability points (stored liability balances are the positive amount owed, AD-5), through `classificationOf`. Pure `netWorthSeries(accounts)` in `domain/net-worth.ts`.
- Range: `to` = today in `deps.timeZone`, rows past today ignored; `from` = today minus the period's months, clamped to the earliest opening date among counted accounts; `all` starts at that date. Reuse `PERIOD_MONTHS`, `periodRange` and `balanceChange` (percent relative to the first point's magnitude, `null` when it is zero, amount alone then).
- `getNetWorth(deps, period)` in new `services/reports.ts`; `GET /api/reports/net-worth?period=` in new `routes/reports.ts`, query parsed by `balanceQuerySchema`, mounted in `app.ts`. Data: `{ period, from, to, currency, netWorth, assets, liabilities, points: [{ date, balance }], change, leftOut: [{ id, name, currency }] }`. `leftOut` lists active, reported accounts in another currency, sorted by name.
- Page `routes/_authed.index.tsx` replaces the redirect: heading « Tableau de bord », one card with « Patrimoine net » in `amount-hero`, the change beside the period, « Actifs » and « Passifs » totals (liabilities positive), the period `ToggleGroup` kept in `?period=` with the account page's fallback, then the chart. Default period `DEFAULT_BALANCE_PERIOD`.
- `BalanceChart` becomes presentational: it takes the history data and a summary key instead of an `accountId`. The account page passes `useBalanceHistory`; the dashboard passes `useNetWorth` with « Patrimoine net : {{balance}}, {{change}} {{over}}. ». Tooltip, « Voir les données » and the empty state stay shared.
- Notice under the card when `leftOut` is not empty: « Hors des totaux, faute de conversion : Compte USD. », names joined by `Intl.ListFormat("fr")`.
- No account at all: « Aucun compte pour l'instant. » and « Ajouter un compte », as the accounts page. Accounts but none counted: zeros and the chart's empty state.
- Sidebar entry « Tableau de bord » first, shortcut `g d` (`goDashboard`), command palette entry. Query key `["accounts", "net-worth", period]`, under `accounts.all`, so every write that moves a balance already refreshes it.
- Strings in `locales/fr.json` under `dashboard`.

**Never:** no exchange rates; no Sure-style balance sheet by account type with weights; no per-point change in the tooltip; no weekly or monthly bucketing for long periods; no stored default period; no change to `recomputeBalances`, `listAccounts` or the `balances` schema; no migration.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Asset and card | Checking 1 000 €, card owing 300 € | Net worth 700, assets 1 000, liabilities 300 | — |
| Late opener | Checking opened day −60, Livret day −10, period 3M | `from` day −60; Livret adds from day −10 only | — |
| Untouched account | Last write 20 days ago | Carried forward to today | — |
| Future entry | Transaction dated tomorrow | Series ends today, excludes it | — |
| Excluded / inactive | One of each | In no total, no point, no notice | — |
| Other currency | Active reported USD account | In no total or point; in `leftOut` | — |
| Zero start | First point 0, last 500 | Change 500, percent `null` | — |
| Negative start | First −200, last −100 | Change +100, +50,0 % | — |
| Nothing counted | No account, or all excluded | Zeros, empty `points`, `from` `null`, `change` `null` | — |
| Bad period | `?period=2W` | — | 400 `VALIDATION_ERROR` |

</frozen-after-approval>

## Code Map

- `packages/api/src/services/balances.ts` -- `PERIOD_MONTHS` 12 (export it), `getBalanceHistory` 39 is the model. `domain/balances/history.ts` -- `periodRange` 17, `balanceChange` 42, `fillDays` 67. `services/ledger.ts` -- `balancesBetween` 1870, `openingDateOf` 1892. `services/settings.ts` -- `getReportingCurrency`. `services/accounts.ts` -- `listAccounts` 88 (counted-set rule to mirror, not to change). `@archant/data/account-types` -- `classificationOf` 33. `schemas/balances.ts` -- `BALANCE_PERIODS`, `DEFAULT_BALANCE_PERIOD`, `balanceQuerySchema`. `app.ts` 53-62 -- chained mounts.
- `packages/web/src/routes/_authed.index.tsx` -- the redirect to replace. `_authed.comptes.$accountId.tsx` 54-62, 356 -- search schema and period wiring to copy. `components/BalanceChart.tsx` -- hard-wired to `useBalanceHistory` today; `Summary`, `Chart`, `DataTable` inside. `hooks/useBalanceHistory.ts` -- model for `useNetWorth` (`placeholderData`). `lib/query-keys.ts`, `hooks/useInvalidateAccount.ts` -- invalidation through `accounts.all`. `components/AppSidebar.tsx` 130-160, `lib/shortcuts.ts` 41-57, `components/CommandPalette.tsx` 100. `lib/balance-change.ts` -- signed formatters. `components/Money.tsx`. `routes/setup.tsx` 38, 109 navigate to `/`.
- Tests: `domain/balances/history.spec.ts` style for the pure function; `app.spec.ts` `openAccount` 258, `postTransaction` 268, `patchAccount` 1815, `describe("GET /api/accounts/:id/balances")` 491, `setToday` pattern in `ledger.spec.ts` 88. E2E: `fixtures.ts` `apiHelpers` (`openAccount` with `currency`, `addTransaction`, `groupTotal` 327), `balance-history.spec.ts` for the chart, `manage-accounts.spec.ts` 84-107 for delta assertions (one database per run, `workers: 1`), `keyboard.spec.ts` for shortcuts.

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/domain/net-worth.spec.ts` -- failing tests for `netWorthSeries`: signs, late opener, day before any account, empty input.
- [x] `packages/api/src/domain/net-worth.ts` -- `netWorthSeries`.
- [x] `packages/api/src/app.spec.ts` -- failing `describe("GET /api/reports/net-worth")` covering every matrix row.
- [x] `packages/api/src/services/reports.ts`, `routes/reports.ts`, `app.ts`, `services/balances.ts` -- service, route, mount, exported `PERIOD_MONTHS`.
- [x] `packages/web/src/components/BalanceChart.tsx`, `routes/_authed.comptes.$accountId.tsx` -- presentational chart, account page unchanged for the user.
- [x] `packages/web/src/hooks/useNetWorth.ts`, `lib/query-keys.ts`, `routes/_authed.index.tsx`, `locales/fr.json` -- dashboard page, notice, empty state.
- [x] `packages/web/src/components/AppSidebar.tsx`, `lib/shortcuts.ts`, `components/CommandPalette.tsx` -- entry, `g d`, palette.
- [x] `packages/web/e2e/dashboard.spec.ts` (new), `e2e/fixtures.ts`, `e2e/keyboard.spec.ts` -- `netWorth()` helper, one test per criterion below.

**Acceptance Criteria:**
- Given a checking account and a card, when the dashboard opens, then « Patrimoine net », « Actifs » and « Passifs » move by the new accounts' balances.
- Given the dashboard, when I pick « 3 M », then the URL holds `period=3M`, the summary reads « … sur 3 mois » with amount and percentage, and « Voir les données » lists the daily values.
- Given an active USD account, when the dashboard opens, then the notice names it and the totals do not move.
- Given any page, when I press `g` then `d`, then the dashboard opens.
- Given an account page, when I change its period, then its chart behaves as before (existing `balance-history.spec.ts` passes unchanged).

## Implementation Notes

- `BalanceChart` takes the whole `UseQueryResult` rather than bare data, so its skeleton and error alert stay shared; the `<section>`, its heading and the new `PeriodToggle` moved to each caller, and a `valueLabel` names the table column (« Solde » or « Patrimoine net »).
- The headline change shows amount and percentage (« +12,40 € (+1,0 %) sur 3 mois »), as the stat block spec asks, where the mockup shows the percentage only.
- `/` is now the dashboard: `auth.setup.ts`, `auth.spec.ts`, `accounts.spec.ts` and `keyboard.spec.ts` expected the old redirect and were adjusted.

## Spec Change Log

## Review Triage Log

| # | Source | Finding | Verdict | Route / evidence |
|---|--------|---------|---------|------------------|
| 1 | blind, edge, gap | Headline skeleton stays forever when `useNetWorth` fails | medium | patch: `data === undefined` also holds on error |
| 2 | blind | Excluded/inactive test uses EUR only, cannot prove `leftOut` skips them | low | patch: test-only |
| 3 | blind, gap | `leftOut` sort untested | low | patch: test-only |
| 4 | blind | No e2e for "accounts but none counted" | low | rejected: API matrix row covers it; the UI is the shared chart empty state |
| 5 | blind | Counted account opening after today untested | low | patch: test-only |
| 6 | blind | `CountedSeries` duplicates `CountedAccount` | low | patch: two sources of the same shape would drift |
| 7 | blind | `currency` typed `string`, not `CurrencyCode` | low | rejected: `BalanceHistory.currency` is `string` too |
| 8 | blind | `BalanceChart` API differs from the spec wording | low | rejected: recorded in Implementation Notes |
| 9 | blind | Net worth request waits for `/api/accounts` | low | rejected: two local round trips on one page |
| 10 | blind | `patchOwn` uses `own?.db` | false | every call follows `openOwn`, which sets `own` |
| 11 | blind | `headline` locator climbs with `..` | low | rejected: test stability only |
| 12 | blind | `daysAgo(0)` vs server time zone | false | every e2e spec uses `daysAgo`; the server runs in the same zone in CI |
| 13 | blind | Green rise untested | low | rejected: cosmetic |
| 14 | edge | Accounts refetch error shows alert and card together | low | rejected: same pattern as the accounts page |
| 15 | edge | Overpaid card makes « Passifs » negative | low | rejected: matches `listAccounts` and the sidebar |
| 16 | edge | `useBalanceHistory` runs on a not-found account page | low | rejected: `notFoundInline` suppresses the toast; one extra 404 |
| 17 | gap | Dashboard `?period=` fallback untested | medium | patch: test-only |
| 18 | gap | Palette « Tableau de bord » entry untested | low | patch: test-only |
| 19 | spec-review standards | e2e `headline` and `total` locate by DOM structure, against AGENTS.md's role-and-name rule | low | patch: stat block and totals are now labelled groups, located by role and name |
| 20 | spec-review standards | Counted-account filter repeats `listAccounts` | low | rejected: the spec forbids changing `listAccounts`; the service comment names the tie |
| 21 | spec-review standards | `BalanceChart.tsx` also exports `PeriodToggle` and `changeText` | low | rejected: both serve the chart's two callers only |
| 22 | spec-review standards | `PERIOD_MONTHS` exported from a service | low | rejected: the spec asks for this export |
| 23 | spec-review spec | Change sits under the headline, not beside the period | false | the spec's « beside the period » is the stat block facing the toggle, as in the mockup |

## Design Notes

Assumptions taken from Sure or the existing code rather than asked: default period `1M` (the account page's, Sure's `last_30_days`); days before an account opens count as zero (Sure); no stored default period (Sure keeps one per user, a single household does not need it); percent `null` on a zero start rather than Sure's ±∞ (already `balanceChange`'s rule). The mockup's card omits the assets and liabilities totals; the story requires them, so they sit under the headline.

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test && pnpm test:e2e` -- expected: all pass, no tracked file modified afterwards.

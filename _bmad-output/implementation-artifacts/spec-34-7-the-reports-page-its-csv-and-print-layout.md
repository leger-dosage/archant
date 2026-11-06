---
title: 'Story 34.7: The reports page, its CSV and print layout'
type: 'feature'
created: '2026-11-06'
status: 'done'
baseline_commit: '7396ed12432b655b3b5b9cf2dacc202c04d18f39'
route: 'dispatch'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Archant has no « Rapports » page. Sure (`00dd977fb`, `reports_controller.rb`, `reports/index.html.erb` and its partials, `print.html.erb`, `layouts/print.html.erb`, `print-report.css`, `reports_{section,sortable}_controller.js`, `User#reports_section_order`) reviews a month, a quarter, a year to date, six months or a custom range, lets each user reorder and collapse its sections, exports a category-by-month CSV and prints a « Rapport financier ».

**Approach:** the API resolves Sure's report period and answers the whole page in one read, `GET /api/reports/page`, plus `GET /api/reports/export` (CSV) and `GET`/`PATCH /api/reports/layout`; the interface adds `/reports` to the navigation and a bare `/reports/print` route outside the shell.

**Split (owner's standing delegation on scope):** Sure's « Performance des investissements » and « Flux d'investissement », on the page and in print, move to new Story 34.11: they need a period return over market flows, realized gains per sale and gains by tax treatment, none of which Archant computes. Sure renders no « Performance budgétaire » section: its `_budget_performance` partial is orphaned, and budget performance is the summary's fourth card. The epic's AC follows Sure.

## Boundaries & Constraints

**Always:**
- Periods are Sure's `monthly` (default), `quarterly`, `ytd`, `last_6_months` and `custom`, with Sure's default bounds on `today(deps.timeZone)`. A custom range with start after end is swapped and flagged with `invalid_date_range`; an unknown type falls back to `monthly`. The comparison period is Sure's day shift: the same day count, ending the day before the start. Sure's `build_period_navigation` gives previous and next for every type but `custom`; « Période suivante » is disabled at the latest period. « Aujourd'hui » goes back to the type's default dates. Sure's labels are « Q4 2026 », « Depuis le début de l'année 2026 », the past year, « juin 2026 – nov. 2026 » and the month name with its year. The popover picker offers months, quarters and years, with future ones greyed out. The type and dates live in the URL (`periodType`, `startDate`, `endDate`).
- `←` and `→` click previous and next, as Sure's `hotkey` controller does: `aria-keyshortcuts` and the tooltip « Période précédente (←) ». They do nothing with a modifier, in an editable field, under an open dialog, on auto-repeat, or while a section is grabbed.
- The summary is fixed on top. Its cards are « Revenus totaux » and « Dépenses totales », each with its change against the comparison period (0 % when the previous total is zero; colours inverted for expenses), « Épargne nette » with « Revenus moins dépenses », and « Performance budgétaire ». That last card shows only for a `monthly` period on the current month, as `actual / budgeted` from `getBudget`; otherwise it shows « Aucune donnée budgétaire pour cette période ». Its bar is red from 100 %, orange from 80 % and green below. The figures are `getIncomeStatement`'s counted rows (AD-9).
- The sortable sections are Sure's `trends_insights`, `transactions_breakdown` and `net_worth`, in Sure's default order. A section the user's stored order leaves out is appended in base order. Each section collapses with its chevron and has a grip. As Sure, `Enter`/`Space` grabs and releases, the arrows move a section, `Escape` releases, and the order saves on release. Mouse drop happens at the vertical midpoint, and touch picks a section up after a 150 ms hold.
- « Tendances et aperçus » has one row per calendar month from the first of the start's month, its end cut to the period end. Its columns are Mois, Revenus, Dépenses, Net and Taux d'épargne (`net / income`, 0 without income), and the current month reads « (actuel) ». The section ends with three monthly averages over the row count.
- « Répartition des activités » follows Sure's rows. These are the counted rows without the pending and internal-movement clauses, plus the counted accounts' trades under « Autres investissements ». The sign gives the side, and a subcategory adds to its parent and is also listed indented. Each row shows its « % du total » of its side, « (n entrées) », and links to `/transactions` filtered on the category and the period, except trade-only rows. « Montant » sorts both ways. The footer reads « Affichage de N entrées », and the section ends with the « CSV » button.
- « Patrimoine net » shows today's net worth, the period's change from `getNetWorth` over the period, « Actifs vs Passifs », a monthly chart from 2 points, and asset and liability group tables from the 34.1 groups, with zero groups dropped.
- The page empty state appears when the household has no transaction at all: « Aucune donnée disponible », its description, and « Ajouter une transaction » and « Ajouter un compte » for an administrator.
- The CSV follows `generate_transactions_csv`. Its header is `Category`, one `%b %Y` English column per month and `Total`. It holds an `INCOME` block, its rows and `TOTAL INCOME`, then an empty row, then `EXPENSES` with `TOTAL EXPENSES`. Categories are flat by name, `Uncategorized` included, and each block is sorted by total, descending. It counts transactions only and keeps pending ones. Amounts are `formatMoney` from integer minor units in the user's locale, and every text cell goes through `export.ts`'s formula guard. The file name is `transactions_breakdown_YYYYMMDD_to_YYYYMMDD.csv`.
- Print opens in a new tab and calls `window.print()` 500 ms after load, as Sure. The layout is Sure's Tufte one, titled « Rapport financier », with the period and « Généré le ». It holds the summary with sparklines and « % vs précédent », « Patrimoine net », « Tendances mensuelles » from 2 months with « Moyenne » and the « * » note, and « Dépenses par catégorie » with the top 8 per side and « + N autres catégories ». It uses A4 `@page` rules.
- English and French locale files both, from Sure's `reports` keys. An English Sure string gets the French a user expects.

**Never:**
- No layout control and no layout write for a viewer (AD-21). A viewer sees Sure's default order and can still export and print.
- No Google Sheets link (Dropped).
- No `filter_*` parameters and no XLSX or PDF, which have no UI in Sure.
- No investment section, which is Story 34.11.
- No new dependency and no raw SQL in application code.
- No general hotkey system: Story 34.9 owns Sure's other keys.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Default | today 2026-11-06, no params | monthly 2026-11-01–2026-11-30; previous 2026-10-02–2026-10-31; next disabled | N/A |
| Quarter back | quarterly 2026-10-01–2026-12-31, previous | 2026-07-01–2026-09-30 | N/A |
| YTD back | ytd 2026, previous | 2025-01-01–2025-12-31; next returns 2026-01-01–today | N/A |
| Six months | today 2026-11-06 | 2026-06-01–2026-11-30; next from 2025-12-01 snaps to it | N/A |
| Reversed custom | start 2026-10-20, end 2026-10-05 | dates swapped, alert shown | N/A |
| Unknown type | `periodType=weekly` | monthly defaults | N/A |
| Zero previous | income 100 €, previous 0 | « +0 % » | N/A |
| Stale order | stored `["foo","net_worth"]` | net_worth, trends_insights, transactions_breakdown | N/A |
| Viewer write | `PATCH /api/reports/layout` | unchanged | `403 FORBIDDEN` |
| Unknown key | `PATCH { sectionOrder: ["foo"] }` | nothing stored | `400 VALIDATION_ERROR` with `fields` |
| CSV, two months | Oct and Nov rows, a subcategory | flat rows, month columns, totals | N/A |

</frozen-after-approval>

## Code Map

- `packages/data/report-periods.ts` (new) -- `REPORT_PERIOD_TYPES`, `reportPeriod(type, start?, end?, today)` returning bounds, `swapped` and `previous`, and `reportNavigation(...)`, all pure, shared as `periods.ts` is. Reuse `domain/dates.ts` (`monthRange`, `addMonths`, `addDays`) logic or `data/months.ts#shiftMonth`; quarters and the six-month snap are new.
- `packages/data/reports-sections.ts`, `reports-layout.ts` (new) -- keys, default order, `resolveReportsLayout`, `mergeReportsLayout` (collapsed merged per key, order replaced), modelled on `dashboard-layout.ts` without hide or size.
- `packages/data/schema/auth.ts` `users` -- `reportsLayout: text("reports_layout", { mode: "json" })`, nullable, beside `dashboardLayout`; `pnpm data generate` writes 0105.
- `packages/api/src/services/reports.ts` -- `getReportsPage(deps, query)`: period, previous and navigation; summary from `getIncomeStatement({ comparePrevious: true })`; trends from monthly totals over `monthRange(start)`–end; breakdown; net worth from `getNetWorth` with a custom range, `getBalanceSheet` (1-month step) and the account groups behind `GET /api/accounts`; budget from `getBudget` when it applies; `hasTransactions`; `hasAccounts`. `getReportsCsv` beside it.
- `packages/api/src/services/ledger/queries.ts` -- `activityByCategory` (new): `countedInCashFlow`'s condition without the `pending` and `INTERNAL_MOVEMENT_LABELS` clauses, grouped per category and sign with `count()`; `activityTrades` sums trades per sign over the counted accounts; `transactionsByCategoryMonth` for the CSV keyed on `substr(date,1,7)`, through `cashFlowKeyed`'s pattern.
- `packages/api/src/services/export.ts` -- export the `csv()` helper and its formula guard (or move them to `lib/csv.ts`) for reuse.
- `packages/api/src/schemas/reports.ts` -- `reportsPageQuerySchema` (`periodType` caught to `monthly`, `startDate`/`endDate` `z.iso.date()` caught to undefined), `reportsLayoutSchema` strict.
- `packages/api/src/routes/reports.ts` -- `GET /page`, `GET /export` (`text/csv`, `Content-Disposition`), `GET`/`PATCH /layout`, the last through `services/reports-layout.ts` in a transaction, as `services/dashboard-layout.ts`.
- `packages/app/src/components/AppShell.tsx` `DESTINATIONS` -- `/reports`, `nav.reports`, `ChartColumnIcon`, after « Factures » (Sure's order: bills, then reports), `phone: false`.
- `packages/app/src/routes/_authed.tsx` -- render the `Outlet` without `AppShell` when the leaf match's `staticData.bare` is set.
- `packages/app/src/routes/_authed.reports.tsx` (new), `_authed.reports_.print.tsx` (new, `staticData: { bare: true }`) -- `validateSearch` as `_authed.index.tsx`.
- `packages/app/src/components/reports/` (new) -- `ReportsPeriodControls.tsx` (segmented tabs, « Du »/« Au », arrows, popover picker on `ui/popover`, « Aujourd'hui »), `ReportsSummary.tsx`, `TrendsSection.tsx`, `ActivityBreakdown.tsx`, `ReportsNetWorth.tsx`, `ReportsEmptyState.tsx`, `ReportPrint.tsx` with `report-print.css` (`@media print`, `@page`).
- `packages/app/src/components/DashboardWidget.tsx#useDashboardSortable` -- make it generic over the key type and take the hold delay (800 dashboard, 150 reports) and save-on-release; `ReportsSection.tsx` (new) wraps it and drives `Section.tsx`'s context for the chevron and the grip.
- `packages/app/src/hooks/useReportsPage.ts`, `useReportsLayout.ts` (new), `lib/query-keys.ts` -- as `useDashboardLayout.ts`.
- Reuse: `components/Money.tsx`, `lib/format-money.ts`, `lib/percent.ts`, `NetWorthSection`'s chart parts, `BudgetMonthPicker.tsx` arrows pattern.
- `packages/app/src/locales/{fr,en}.json` -- `nav.reports`, `reports.*`.
- `packages/app/e2e/reports.spec.ts` (new) and `fixtures.ts`; `keyboard.spec.ts` header names the reports arrows as Sure's exception; `reports-layout` tests go in the `layout` project (`playwright.config.ts`), which already isolates the single administrator's layout.
- `docs/sure-parity.md` row 245 -- page, CSV and print to Parity for 34.7, investment sections Later for 34.11, Google Sheets Dropped as written; `AGENTS.md` « Testing » if the `layout` project's description changes.

## Tasks & Acceptance

**Execution:**
- [x] `packages/data/report-periods.spec.ts` then `report-periods.ts` -- failing tests first: every row of the matrix's period lines, quarter and year boundaries, `at_latest` per type, the six-month snap, labels' inputs.
- [x] `packages/data/reports-layout.spec.ts` then `reports-layout.ts`, `reports-sections.ts`; the column and migration 0105; `migrate.spec.ts` reads null for an existing user.
- [x] `packages/api/src/services/reports.spec.ts` (ledger database) -- summary changes and zero-previous rule, budget card only on the current month, trends rows unclipped at start, breakdown with pending, trades and subcategory, CSV of two months with a subcategory and `Uncategorized`, a formula-like category guarded.
- [x] Queries, services, schemas and routes; `routes/reports.spec.ts` with `useSignedInApp()`: page round trip, CSV headers and filename, layout round trip, unknown key `400`, viewer `PATCH` `403`, viewer `GET /export` `200`.
- [x] App: navigation, bare layout, routes, components, hooks, generic sortable, print styles, locales.
- [x] `packages/app/e2e/reports.spec.ts` -- seed two months of categorised transactions; open « Rapports » from the navigation; switch to « Trimestriel » and read the quarter label; `←` moves to the previous quarter and « Aujourd'hui » returns; download the CSV and check `suggestedFilename()` and its first line; « Imprimer le rapport » opens a page whose heading is « Rapport financier ».
- [x] `layout` project: collapse « Patrimoine net », move « Répartition des activités » up with `Space`, `ArrowUp` and `Space`, reload, both kept; reset through the API.
- [x] `docs/sure-parity.md`, `keyboard.spec.ts` header.

**Acceptance Criteria:**
- Given a viewer, when « Rapports » renders, then there is no chevron and no grip, and the CSV and print still work.
- Given the finished story, when `pnpm test` and `pnpm test:e2e` run, then both pass.

## Implementation Notes

- `getReportsPage` and `getReportsCsv` live in `services/reports-page.ts`, beside `services/reports.ts`, which was already near a thousand lines; it exports `cashFlowAccounts`, `breakdownCategories` and `monthBuckets` to them. The specs are `services/reports-page.spec.ts` and the new blocks of `routes/reports.spec.ts`.
- The summary and trends read the counted rows once through `cashFlowByDay` and `grossCashFlow`, as `getIncomeStatement` does, rather than calling it: its 36-month ceiling would refuse a long custom range, and without `accountIds` it reads the whole history for statistics the page never shows.
- `countedInCashFlow` now builds on `activityCondition`, the breakdown's and CSV's rows; `activityByCategory`, `activityTrades` and `transactionsByCategoryMonth` key the side on `amount < 0`, so a zero amount is income, as Sure's `entry.amount > 0 ? "expense" : "income"`.
- `useDashboardSortable` takes the key type and a `drop` rule (`nearest` for the dashboard, `midpoint` for reports); `useTouchHold` takes the hold delay. `Section`'s context is lent by `ReportsSection` through the exported `DashboardWidgetContext`.
- The print styles are `@utility` blocks in `components/reports/report-print.css`, imported by `styles.css`, so `shadcn/no-unknown-classes` knows them; `@page` is A4. The chart past Sure's 400 monthly points is not drawn.
- « Ajouter une transaction » in the empty state shows once an account can take a transaction, as the operations list's button.

## Spec Change Log

## Review Triage Log

| # | Layer | Finding | Verdict | Evidence | Route |
|---|-------|---------|---------|----------|-------|
| 1 | blind | AD-9 in `docs/architecture.md` not updated for the wider activity rows | low | AD-9 names `countsInCashFlow` as every cash-flow report's rule; breakdown and CSV now read `activityCondition` | patch |
| 2 | blind | `reportsPage` key under `accounts.all`, not invalidated by recategorising or budget saves | medium | `useInvalidateBulk({ balances: false })` invalidates `transactions.all` and `accounts.goals` only (`useTransactions.ts:270`) | patch (`staleTime: 0`) |
| 3 | blind, edge | custom range unbounded: ~120,000 monthly buckets, year-0 previous range | medium | `z.iso.date()` accepts 0001-01-01..9999-12-31; `monthBuckets` loops per month | patch (1900–2100 bound) |
| 4 | blind | `←`/`→` act inside an open menu or listbox | low | `isPeriodHotkey` checks fields and `[role=dialog]` only | patch |
| 5 | blind | global `@page` rule changes printing of every page | low | `report-print.css` imported by `styles.css` at root | patch |
| 6 | blind | unused `reports.loadError`, duplicate `documentTitle` | low | no reader of `reports.loadError`; `documentTitle` equals `title` | patch |
| 7 | blind | parity row omits known differences | low | foreign-currency accounts left out and CSV amount locale not recorded | patch |
| 8 | blind, verif | `netWorthOf` re-implements `reportedAccounts`' filter; group sums untested against totals | low | same three conditions as `reports.ts:104` today; no divergence now, fix needs new plumbing | reject |
| 9 | blind | duplicate account and category reads; volume project skips new queries | maybe-false | single household; plans of `activityByCategory` mirror `cashFlowByCategory` but are unmeasured | defer |
| 10 | blind, verif | `duplicate_section` untested | low | only `dashboard.spec.ts:119` covers it | patch |
| 11 | blind, edge | PATCH for a deleted user answers 200 | false | the session check runs first; a deleted user has no session | reject |
| 12 | blind, verif | empty state and midpoint drop untested | medium | no e2e renders « Aucune donnée disponible »; only keyboard reorder tested | patch |
| 13 | blind, edge | spec says both CSV blocks always; code omits an empty side | false | code matches Sure's `generate_transactions_csv`; fix would edit this spec | reject |
| 14 | blind | hardcoded `"none"` uncategorised value | low | `UNCATEGORISED` exists in `schemas/transactions.ts` | patch |
| 15 | blind | `staticData.bare` undocumented | low | new shell-less route kind; fix edits agent-context docs | defer |
| 16 | edge | parent row's link omits its subcategories | medium | `categoryCondition` matches exact ids (`filter.ts:102`); Sure's `apply_category_filter` adds subcategories | patch |
| 17 | edge | category link lacks an account filter | false | Sure's link carries no account filter either | reject |
| 18 | edge | empty `sectionOrder` shows base order | false | Sure's `[] \|\| default` keeps `[]` (Ruby truthy), same result | reject |
| 19 | edge | print dialog can open twice on a locale change | low | effect depends on `t` (`ReportPrint.tsx:147`) | patch |
| 20 | edge | negative budget percent breaks the bar | low | refunds above spending give a negative ratio; width and `aria-valuenow` unclamped | patch |
| 21 | edge | failed layout read shows default, next drag overwrites | low | rare; same as the dashboard's 34.6 behaviour; fix adds a branch | reject |
| 22 | edge | picker can step below year 1000 | low | needs hundreds of clicks; fix adds a guard | reject |
| 23 | edge | future years removed instead of greyed | false | Sure's ytd grid lists years up to the current one only | reject |
| 24 | verif | CSV, print and row links not checked against the shown period | gap | `reports.spec.ts` asserts regexes only | patch |
| 25 | verif | `lib/reports.ts`, `formatChangePercent` untested | gap | no spec file for either | patch |
| 26 | verif | hotkey guards untested | gap | only a plain `ArrowLeft` is pressed | patch |
| 27 | verif | `window.print()` call not asserted | gap | stubbed to a no-op | patch |
| 28 | verif | 150 ms touch hold untested | gap | Playwright long-press emulation is unreliable; the delay is a parameter | defer |

## Design Notes

One read, `GET /api/reports/page`, mirrors Sure's controller: the print route uses it too, so the page and print never disagree. Summary and trends use the counted rows (AD-9), while breakdown and CSV use Sure's wider rows. The totals may therefore differ, as they do in Sure. Do not "fix" that.

## Verification

**Commands:**
- `pnpm lint:code && pnpm lint:format && pnpm typecheck` -- expected: clean
- `pnpm test` -- expected: green, the new period, layout, service and route specs included
- `pnpm test:e2e` -- expected: green, `reports.spec.ts` and the layout test included

**Manual checks:**
- Screenshot `/reports` at 1440 px and 390 px, the empty state and the print page; compare with Sure's layout under Archant's style.

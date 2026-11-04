---
title: 'Story 34.3: Pick the dashboard period'
type: 'feature'
created: '2026-11-04'
status: 'done'
baseline_commit: 'c8922d77f37f7846b8be19c299f13c76fdc774c2'
route: 'dispatch'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** the dashboard and account charts offer Archant's own « 1 M, 3 M, 6 M, 1 A, Tout » (`PeriodToggle`, `BALANCE_PERIODS`), forget the choice, cannot take a dragged range, and the loan chart offers every period. Sure (`00dd977fb`) has one `UI::PeriodPicker` menu over `Period::PERIODS`, saved per user as `default_period` by `Periodable`, a custom range dragged on the chart (`_navigateToDateRange`), `comparison_label` under the headline, and on a loan `Loan::PayoffChart::WINDOW_KEYS` with « Tout » for any other period.

**Approach:** the API takes Sure's period keys or a custom `startDate`/`endDate` on its three chart reads and saves `defaultPeriod` on `users` through `PATCH /api/preferences`; the interface replaces `PeriodToggle` with a `PeriodPicker` menu, keeps the pick in the URL, saves it for an administrator, and lets a drag on `BalanceChart` set a custom range.

## Boundaries & Constraints

**Always:** keys, order and labels are Sure's `Period::PERIODS` and `config/locales/models/period/{fr,en}.yml` (`label_short`, `comparison_label`, custom `label_short` « Personnalisé », `range` « %{start_date} – %{end_date} »); « 30J » `last_30_days` is the default and the fallback for any unknown key or invalid custom range (unparsable, or start after end), as `Periodable`. Ranges come from `surePeriodRange` on `today(deps.timeZone)`, clamped to the account's or the household's history start. Picks go to the URL (`period`, or `startDate` and `endDate`, replace). Only an administrator's pick of a key is saved (AD-21); a custom range is never saved, as Sure. The loan chart's domain is Sure's `domain_start`/`domain_end`: whole life for `all_time`, a custom range or a key outside `WINDOW_KEYS`.

**Never:** no change to `CashFlowSection`'s month, which is Sure's `money_flow` month and has its own arrows; no change to MCP tools, which already take `SURE_PERIODS`; no keyboard or touch drag (Sure's brush is mouse-only); no new dependency.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| First visit | no URL period, `default_period` unset | « 30J », headline « vs. 30 derniers jours » | N/A |
| Admin picks | « 90J » | URL `period=last_90_days`; `PATCH {defaultPeriod}`; `/` later opens on « 90J » | failed save: toast, URL still applies |
| Viewer picks | « AC » | URL only, no request | N/A |
| Drag | mouse from 2026-10-05 to 2026-10-20 | URL `startDate`/`endDate`, trigger « 5 oct. – 20 oct. », « Personnalisé » checked last; headline « 5 oct. 2026 au 20 oct. 2026 » | drag collapsing to one point: nothing |
| Bad range | `startDate=2026-10-20&endDate=2026-10-05` | API and interface use `last_30_days` | N/A |
| Account newer than period | history from 2026-10-25, « 90J » | « par rapport à l'historique disponible » | N/A |
| Loan, saved « 7J » | schedule present | menu of seven `WINDOW_KEYS` options, « Tout » checked, whole life; saved period unchanged | N/A |
| `current_month` | `APP_TIMEZONE` Europe/Paris, 2026-10-31T23:30Z | 2026-11-01 to 2026-11-01 | N/A |

</frozen-after-approval>

## Code Map

- `packages/api/src/domain/balances/sure-periods.ts` -- `SURE_PERIODS`, `surePeriodRange` reused; add `LOAN_WINDOW_PERIODS` (Sure's `WINDOW_KEYS`) and `resolveChartRange(query, today, oldest)` returning `{ period: SurePeriod | null, range }` with the `last_30_days` fallback.
- `packages/api/src/schemas/balances.ts` -- `BALANCE_PERIODS` becomes `SURE_PERIODS`, default `last_30_days`; `balanceQuerySchema` adds optional `startDate`/`endDate` (`z.iso.date()` with `.catch(undefined)`), an unknown `period` caught to the default.
- `packages/api/src/domain/balances/history.ts` -- `periodRange(months…)` gives way to a clamp of a `DateRange` to a start date; `PERIOD_MONTHS` in `services/balances.ts` goes.
- `packages/api/src/services/balances.ts#getBalanceHistory`, `services/reports.ts#countedSeries`/`getNetWorth`, `services/loans.ts#loanPayoffChart` -- take the resolved range; responses return `period` (key or `null`) and `periodFrom`, the unclamped start, so the interface picks the comparison label.
- `packages/api/src/domain/loans/payoff-chart.ts#chartDomain` -- takes `range: DateRange | null` (null = whole life) instead of `months`; window end `max(min(range.to, wholeLifeEnd), from + 1)`.
- `packages/data/schema/auth.ts` `users` -- `defaultPeriod: text("default_period").$type<SurePeriod>().notNull().default("last_30_days")` with a `users_default_period_check` as `users_default_account_order_check` (`schema/check.ts`), covered in `migrate.spec.ts` beside it; key list in `@archant/data` (new `periods.ts`, imported by `sure-periods.ts`) so the schema does not import the API; `pnpm data generate` writes migration 0103.
- `packages/api/src/schemas/preferences.ts`, `services/preferences.ts` -- `defaultPeriod` as `defaultAccountOrder`; `routes/preferences.spec.ts` beside.
- `packages/app/src/components/PeriodToggle.tsx` -- deleted; new `PeriodPicker.tsx` on `ui/dropdown-menu` `DropdownMenuRadioGroup`, trigger `Button variant="outline" size="sm"` with chevron, `aria-label` « Période : 30J » (Sure's `UI.period_picker.aria_label`), optional `options` for the loan.
- `packages/app/src/lib/periods.ts` (new) -- `selectedPeriod(search, saved)`, `loanPickerSelection(period)`, `rangeLabel(from, to, today)` (year dropped inside the current year, as `label_range`), `comparisonText`.
- `packages/app/src/hooks/usePreferences.ts` -- `useSaveDefaultPeriod`: optimistic `setQueryData`, no invalidation of accounts or transactions.
- `packages/app/src/routes/_authed.index.tsx` -- search `period`/`startDate`/`endDate`; picker in a right-aligned row above the grid when `hasAccounts`; chart reads wait for preferences only when the URL names no period.
- `packages/app/src/components/NetWorthSection.tsx` -- no `action`; `dashboard.change` takes the comparison label instead of `balances.over`.
- `packages/app/src/routes/_authed.accounts.$accountId.tsx` (search ~l.103, period ~l.539–613, toggle l.686) -- same picker and search params; for a charted loan, `options` from `LOAN_WINDOW_PERIODS` and selection via `loanPickerSelection`; `defaultPeriod = "all"` special case goes.
- `packages/app/src/components/BalanceChart.tsx` -- `onRangeSelect?(from, to)`: `onMouseDown`/`onMouseMove`/`onMouseUp` with Recharts `activeLabel`, a `ReferenceArea` while dragging, ignored when both ends snap to one date.
- `packages/app/src/hooks/useNetWorth.ts`, `useBalanceHistory.ts`, `useLoanPayoffChart.ts`, `lib/query-keys.ts` -- take a `ChartPeriod` (`{ period } | { startDate, endDate }`).
- `packages/app/src/locales/{fr,en}.json` -- `periods.<key>.short`, `.comparison`, `periods.custom.*`, `periods.range`, `periods.availableHistory`, `periods.ariaLabel`; drop `balances.periods`, `balances.over`.
- `packages/app/e2e/fixtures.ts` -- `setDefaultPeriod`, as `setAccountOrder`.
- `packages/app/e2e/balance-history.spec.ts`, `accounts.spec.ts` (l.896, 984–1001, 1116, 1157), `dashboard.spec.ts` -- radios become menu items.
- `docs/sure-parity.md` -- Loan row's « Later. Story 34.3 » becomes Parity; Cash flow row's 34.3 mention moves to 34.4; balance history and net worth rows; `DESIGN.md` « Net worth card » (l.329) names « a segmented period control in the header »: the picker now sits above the widgets.

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/domain/balances/sure-periods.spec.ts`, `domain/loans/payoff-chart.spec.ts` -- failing tests first: `resolveChartRange` (key, custom, reversed, unparsable), `LOAN_WINDOW_PERIODS` ⊂ `SURE_PERIODS` in order, `chartDomain` whole life for `null`, window clamped to origination.
- [x] `packages/data` -- `periods.ts`, `users.defaultPeriod` and its check, migration 0103; `migrate.spec.ts`: an existing user reads `last_30_days`, an unknown key is refused.
- [x] API schemas, services, routes as in the Code Map; route specs for `GET /api/reports/net-worth`, `/api/accounts/:id/balances`, `/payoff-chart` with a key, a custom range, an invalid range and an old `1M`; `current_month` under `APP_TIMEZONE` at a month boundary; `PATCH /api/preferences` saves `defaultPeriod`, refuses an unknown key with `VALIDATION_ERROR`, a viewer gets `FORBIDDEN`.
- [x] `packages/app/src/lib/periods.spec.ts` then `periods.ts` -- selection precedence (URL range, URL key, saved, default), loan selection, range label with and without year.
- [x] App components, hooks, routes and locales as in the Code Map; delete `PeriodToggle.tsx`.
- [x] `packages/app/e2e/dashboard.spec.ts` -- the picker lists the twelve labels in order with « 30J » checked; pick « 90J », `goto("/")`, « 90J » and « vs. dernier trimestre »; drag across the chart, the trigger shows the dates and « Personnalisé » is checked; `setDefaultPeriod("last_30_days")` in `finally`.
- [x] `packages/app/e2e/accounts.spec.ts` -- with « 7J » saved, a loan's picker lists its seven options with « Tout » checked; restore the default.
- [x] Existing e2e period tests rewritten for the menu; viewer test: a pick changes the URL and sends no `PATCH`.
- [x] `docs/sure-parity.md`, `DESIGN.md`.

**Acceptance Criteria:**
- Given the dashboard with accounts, when it renders, then one picker sits above the widgets with Sure's twelve periods in order, « 30J » by default, and no `PeriodToggle` remains.
- Given the account page, when its chart renders, then it uses the same picker and the same saved period.
- Given the finished story, when `pnpm test` and `pnpm test:e2e` run, then both pass.

## Implementation Notes

- Decision, Sure settles it: the custom row reads « Personnalisé », Sure's `period.custom.label_short` that `UI::PeriodPicker#custom_row?` renders; the story's « Période personnalisée » is Sure's `label`, used nowhere in the menu.
- Decision, Sure settles it: the account balance chart is drag-selectable too, `data-time-series-chart-selectable-value` on both of Sure's charts; the loan chart is not.
- Decision: a pick always writes the URL, so a viewer's choice works and Back/Reload keep it; the saved period applies only when the URL names none.
- Assumption: `startDate`/`endDate` in camelCase, as Archant's other search params (`snapshotsPage`).
- The chart query keeps `startDate`/`endDate` as strings, not `z.iso.date().catch(undefined)` as the Code Map said: a date that does not parse must fall back to `last_30_days`, as Sure, rather than being dropped so the key applies.
- Migration 0103 is written by hand, not by `pnpm data generate`: Drizzle rebuilt `users` and copied a column the old table lacks. `drizzle-kit generate` afterwards reports no schema change, so the snapshot matches.
- `hooks/useChartPeriod.ts` shares the URL-then-saved reading and the admin-only save between the two pages.

## Review Triage Log

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | Overlapping saves of the period can land out of order, and a rollback can drop the newer pick | medium | patch | `useSaveDefaultPeriod` had no mutation scope; `scope` serialises them. |
| 2 | e2e `finally` resets can race a UI pick's PATCH still in flight | medium | patch | Picks are fire-and-forget; the tests now wait for the response. |
| 3 | Matrix row « failed save » untested | medium | patch | No `page.route` on `/api/preferences`; test added. |
| 4 | « falls back to the saved one » tests run with the default saved | low | patch | They passed with either reading; another period saved first. |
| 5 | Account page custom range and saved pick untested | medium | patch | Removing `onRangeSelect` or `save` broke nothing; tests added. |
| 6 | Drag read a stale closure on mouse up, took any button, selected text | low | patch | Ref, primary button only (Sure's d3-brush filter), `select-none`. |
| 7 | « Tout » on an account opened today read « historique disponible » | low | patch | Sure's `UI::Account::Chart#period` moves `all_time`'s start to the history start. |
| 8 | Loan payload's `periodFrom` unused and wrong on the whole-life fallback | low | patch | No reader in the interface; deleted. |
| 9 | Custom range validity written twice, API and app | low | patch | One helper in `@archant/data/periods`. |
| 10 | DESIGN.md and a comment say the picker serves every chart, the cash flow month excluded | low | patch | `CashFlowSection` keeps its month (Never). |
| 11 | README screenshots show the old toggle | low | defer | Story 37.5 regenerated them; a fresh capture belongs to that process. |
| 12 | No dashboard test with history shorter than the period | low | defer | The shared e2e database has years of history. |
| 13 | No test that the first read waits for the saved period | low | defer | Final state is right; only a transient extra read. |
| 14 | Sprint status `in-progress` while the spec is `in-review` | false | reject | Both become `done` at the end of the workflow. |
| 15 | Date query params unbounded strings | low | reject | Validated in `resolveChartRange`; URL length is bounded by the server. |
| 16 | Spec says migration generated, code hand-written | low | reject | Fix edits the spec; recorded in Implementation Notes. |
| 17 | Drizzle snapshot not in the reviewed diff | false | reject | `drizzle-kit generate` reports no schema change. |
| 18 | Future custom end date: trigger and comparison disagree | low | reject | Reachable only by a hand-edited link; a drag never passes today. |
| 19 | Picker reads « 30J » while preferences load | low | reject | `useFollowSavedLocale` loads preferences at start; a guard adds a branch for a blink. |
| 20 | Year dropped by the browser's date, not `APP_TIMEZONE` | low | reject | The interface already reads the browser's date for the month (`toIsoMonth`). |
| 21 | `.catch().default()` redundant | low | reject | `.default` keeps the Hono client's input optional. |
| 22 | Admin role unknown before the session loads | false | reject | `_authed` loads the session before any page renders. |
| 23 | Wholly future custom range gives `periodFrom` after `to` | low | reject | Hand-edited link only; the chart shows its empty state. |

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck` -- expected: clean, knip finds no leftover `PeriodToggle`, `PERIOD_MONTHS` or locale key.
- `pnpm test` -- expected: green, the new period and preference specs included.
- `pnpm test:e2e` -- expected: green.

**Manual checks:**
- Screenshot the dashboard picker open, a custom range, and a loan's picker, in French and English.

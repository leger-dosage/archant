---
title: "Story 17.1: Set up a month's budget"
type: 'feature'
created: '2026-10-03'
status: 'done'
route: 'dispatch'
baseline_commit: 'e4b96206d20eb958b3f26a870bffc1143f108cbd'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-17-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Archant shows what a month cost, never what the household meant to spend or earn, so the owner cannot tell whether the month is on track.

**Approach:** A `budgets` table, one row per calendar month, holding a planned spending total and an expected income; a month page at `/budgets/:month` comparing them with actual spending and income taken from the dashboard's cash flow (AD-9), and a form whose « Suggérer » fills the median of earlier months, as Sure's `Budget`. Story 17.1 of `epics.md` is the acceptance contract; this spec records what reading Sure and the code settled.

## Boundaries & Constraints

**Always:**
- `budgets (id, month, currency, budgeted_spending, expected_income, created_at, updated_at)`, unique on `month`, amounts nullable integers; set up means `budgeted_spending` is not null. `services/budgets.ts` writes it, in a `behavior: "immediate"` transaction, upsert on `month`, `currency` the reporting currency.
- `GET /api/budgets/:month` never writes. It answers the month's figures whether set up or not. `PUT /api/budgets/:month` takes `{ budgetedSpending, expectedIncome }` as text, both required, parsed with `parseAmount` in the reporting currency, never negative.
- Valid months, as Sure's `budget_date_valid?`: from `min(current month − 24, month of the oldest entry)` to `current month + 24`, current month in `APP_TIMEZONE`. The oldest entry is the earliest `entries.date` of any kind on any account; none means the current month. A month outside answers `404 NOT_FOUND` on read and write; a malformed one `400 VALIDATION_ERROR`. The response carries `previousMonth` and `nextMonth`, `null` when out of range, and both bounds for the picker.
- Actuals come from `getCashFlow` in `services/reports.ts` (AD-9, reporting currency, `leftOut`). Spending is the sum, over top-level expense categories, of `max(−line, 0)`, plus the uncategorised outflow; income is `max(income, 0)` of the same breakdown. The donut's segments are those expense lines, largest first.
- The suggestion is the median, rounded to the minor unit, of the figure over the months before both the shown month and the current month, from the first counted line on; a month enters a figure's median only when its breakdown has a line on that side. No such month gives `null`; both `null` disables « Suggérer ».
- The month query key sits under `["transactions", ...]`, so every transaction write refreshes the actuals.
- Rail order: Accueil, Opérations, Comptes, Budgets, Récurrent, Règles, Réglages.

**Never:** no `budget_categories`, category amounts, statuses, copy, rollover or MCP tool (17.2 to 17.5); no row created on read; no `month_start_day`; no conversion of another currency; no actuals shown for a month not set up.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Not set up | GET a valid month, no row | `setUp: false`, amounts `null`, actuals and suggestions filled, no row written | N/A |
| Save | PUT `"2 000,00"`, `"2 500"` | row upserted, `setUp: true`, `200000`, `250000` | N/A |
| Blank or negative | PUT `""` or `"-5"` | nothing written | `VALIDATION_ERROR`, `too_small` or `negative_amount` on the field |
| Refund above spending | expense category nets `+30` | that category spends 0, draws no segment | N/A |
| Median | earlier months spending 100, 300, 200, 400 | 250 | N/A |
| No history | no counted line before the month | both suggestions `null` | N/A |
| Out of range | current month + 25, or before the lower bound | nothing written | `404 NOT_FOUND` |
| Other currency | a USD account with lines | left out of actuals and medians, named in `leftOut` | N/A |

</frozen-after-approval>

## Code Map

- `packages/data/schema/tags.ts` -- table model; new `schema/budgets.ts`, subpath in `packages/data/package.json`, type in `types.ts`, migration through `pnpm data generate --name add_budgets`, a case in `packages/data/migrate.spec.ts` if earlier migrations have one.
- `packages/api/src/services/reports.ts:63` `reportedAccounts`, `:178` `getCashFlow`; `domain/cash-flow.ts:104` `cashFlowBreakdown`.
- `packages/api/src/services/ledger/queries.ts:449` `cashFlowByCategory` -- add `cashFlowByMonth` (same `filterCondition`, grouped by `substr(date, 1, 7)`, category, sign) and `oldestEntryDate`; ledger-only tables may not be read elsewhere (AD-2 lint).
- `packages/api/src/domain/dates.ts` `today`, `monthRange`; `packages/data/months.ts` `shiftMonth`; `schemas/reports.ts:4` `monthSchema`.
- `packages/api/src/schemas/snapshots.ts` -- text amount parsed per currency; model for `schemas/budgets.ts`.
- `packages/api/src/routes/tags.ts` + `tags.spec.ts` -- route and spec model (`useSignedInApp()`); mount in `app.ts:232` `createApi`.
- `packages/app/src/components/CashFlowSection.tsx:85` `Donut`, `CashFlowChart.tsx` (lazy recharts ring) -- reuse the ring; `NetWorthSection.tsx:118` `dashboard.leftOut` notice.
- `packages/app/src/routes/_authed.settings.index.tsx` -- redirect model; `_authed.index.tsx` page model; `components/SnapshotDialog.tsx` -- unsigned money field with react-hook-form, `applyFieldErrors`.
- `packages/app/src/components/AppShell.tsx:55` `DESTINATIONS`; `e2e/shell.spec.ts:17` its list.
- `packages/app/src/hooks/useCashFlow.ts`, `lib/query-keys.ts`, `lib/dates.ts` `toIsoMonth`, `ofMonth`; `locales/fr.json`.
- Docs: `_bmad-output/planning-artifacts/ux-designs/ux-archant-2026-09-21/EXPERIENCE.md:33`, `docs/sure-parity.md:217`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/domain/budgets/actuals.spec.ts`, `actuals.ts` -- first the tests: spending with refunds and uncategorised outflow, income floor, median odd/even/empty, month eligibility per side; then the functions.
- [x] `packages/api/src/domain/budgets/months.spec.ts`, `months.ts` -- bounds and neighbours, tests first.
- [x] `packages/data/schema/budgets.ts`, migration, exports, `types.ts`.
- [x] `packages/api/src/services/ledger/queries.ts` -- `cashFlowByMonth`, `oldestEntryDate`, with a parity test against `cashFlowByCategory`.
- [x] `packages/api/src/services/reports.ts` -- the month series over the counted accounts.
- [x] `packages/api/src/schemas/budgets.ts`, `services/budgets.ts`, `routes/budgets.ts`, `routes/budgets.spec.ts`, `app.ts` -- every matrix row through the route; `lib/errors.ts` unchanged.
- [x] `packages/app/src/hooks/useBudget.ts`, `lib/query-keys.ts`, `routes/_authed.budgets.index.tsx`, `_authed.budgets.$month.tsx`, `_authed.budgets.$month.edit.tsx`, `components/BudgetMonthPicker.tsx`, `BudgetDonut.tsx`, `BudgetSummary.tsx`, `AppShell.tsx`, `locales/fr.json`.
- [x] `packages/app/e2e/budgets.spec.ts`, `e2e/shell.spec.ts` -- redirect, picker bounds and « Aujourd'hui », set up through the form with « Suggérer », donut centre and summary, left-out notice, rail order.
- [x] `EXPERIENCE.md`, `docs/sure-parity.md`, `epics.md` 17.1 bound wording.

**Acceptance Criteria:**
- Given Story 17.1 of `epics.md`, when the story ships, then each of its criteria holds, with the revisions this spec records.
- Given a month set up and over budget, when its page opens, then the donut's spent amount shows in the destructive colour and the summary says by how much.

## Design Notes

The epic's AC says « more than two years before the oldest entry's month »; Sure's rule, which it cites, is `start >= min(2.years.ago, oldest_entry_date)`. Sure wins and the AC's wording is corrected in `epics.md`.

The median excludes the current, partial month, where Sure's `median_expense` includes it: the AC says « earlier months », and a half month drags the suggestion down.

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck` -- expected: clean
- `pnpm test` -- expected: green, `domain/budgets/` covered to the branch
- `pnpm test:e2e` (under the lock) -- expected: green

## Implementation Notes

- The edit route is `_authed.budgets.$month_.edit.tsx`, not `_authed.budgets.$month.edit.tsx`: the trailing underscore keeps it out of the month page's layout, as `_authed.settings.banks_.$connectionId.tsx` does, so the URL is still `/budgets/:month/edit`.
- The donut adds Sure's grey « unused » segment for what is left of the budget, and a single grey ring when nothing is spent and nothing is left, as `to_donut_segments_json`.
- `migrate.spec.ts` gains a `budgets` case: one row per month, amounts null or never negative, a check constraint the migration adds.
- `epics.md` 17.1 also names the rail order the spec records, between « Comptes » and « Récurrent »; `EXPERIENCE.md` does the same.

## Spec Change Log

## Review Triage Log

| Layer | Finding | Verdict | Evidence | Route |
|---|---|---|---|---|
| blind, edge, standards | `budgets.currency` is written, never read; a change of reporting currency would relabel old amounts | low | `getReportingCurrency` returns the constant `EUR`; no setting can change it today | rejected: unreachable, a guard for a future setting |
| blind, edge, spec | The current month is the browser's for `/budgets` and « Aujourd'hui », `APP_TIMEZONE`'s for the bounds | low | The dashboard does the same; the two differ only around midnight on the 1st when the zones differ | rejected: dashboard parity |
| edge | The e2e test's current month can differ from the server's at a month boundary | false | `daysAgo`, the browser's `timezoneId` and the server's `APP_TIMEZONE` all come from `e2e/settings.ts` `TIME_ZONE` | rejected |
| blind, edge, standards, spec | `cashFlowByMonth` repeats `cashFlowByCategory`'s counting conditions | medium | Two copies of `filterCondition` plus `excluded` and `pending`; a later counting change (Epic 19 splits) could miss one | patched: one `countedInCashFlow` in `ledger/queries.ts` |
| blind | Every page open aggregates the whole history; nothing measures it | low | Measured on the volume seed: about 175 ms for `getBudget` at 100,000 transactions over ten years; NFR10 sets no target for this page | rejected: acceptable, noted in the pull request |
| blind, standards | `services/reports.ts` imports `MonthBreakdown` from `domain/budgets/`; `getCashFlowHistory` returns fields nobody reads | low | A generic report depended on the budget feature | patched: type in `domain/cash-flow.ts`, the history returns its months |
| blind | Validation tests cover `budgetedSpending` only | low | The matrix asks for the code « on the field » | patched: three `expectedIncome` rows |
| blind, edge | A month not set up does not name the accounts left out | false | That page shows no figure; the form, whose suggestions are figures, names them | rejected |
| blind, standards | The left-out paragraph is copied three times | low | `NetWorthSection` and both budget pages | patched: `LeftOutNotice` |
| blind | The edit page's « Budgets » crumb leads to the current month, not the edited one | low | « Annuler » leads back to the month | rejected |
| blind | The donut has no legend; its name counts « Sans catégorie » as a category | low | Story 17.2 adds the category cards; Sure's donut names segments on hover only | rejected |
| blind | The Playwright medians depend on no other test writing euros before November 2023 | low | True of the shared database | patched: the comment states that constraint |
| blind | `last_updated` moves back; spec and sprint status disagree | false | The planning commit wrote a later hour; both reach `done` at completion | rejected |
| blind | No check constraint on `budgets.month`'s format | low | Only the service writes it, through `monthSchema`; no date column carries one | rejected |
| blind | `saveBudget` parses the body under the write lock | low | Parsing needs no database | patched: parsed before the transaction |
| blind | `EmptyState` icon kinds borrowed from transfer and uncategorised | low | Cosmetic; `EmptyState` takes no other way to pass an icon | rejected |
| edge | Bounds can shrink past a saved month as time passes | low | Sure's `budget_date_valid?` does the same | rejected: Sure parity |
| edge | A failed refetch shows an error or « hors de portée » beside cached data | low | TanStack Query keeps `data` with `isError` | patched: both states only without data, on both pages |
| edge | A currency that fails `isCurrencyCode` leaves the edit page empty | false | The currency is the reporting currency, `EUR` | rejected |
| edge | A month whose spending nets to zero is left out of the median | low | `cashFlowBreakdown` drops zero lines; the spec ties eligibility to a line on that side | rejected |
| standards | A bare `number` stands for money in `medianOf`, `spentOn`, `segmentsOf`, `Plan`, `textOf` | medium | `AGENTS.md`: « A bare `number` in a function signature that means money is a bug » | patched: `MinorUnits` |
| standards | `routes/budgets.spec.ts` deletes `entries` and `balances` in raw SQL | low | AD-2 limits direct seeding to `testing/ledger.ts`; each test has its own database anyway | patched: `ownDatabase()` |
| standards | `BudgetMonthPicker` redeclares the bounds type | low | `BudgetData["bounds"]` exists | patched |
| standards | Duplicated alert blocks, `Plan`'s ten props, `BudgetOutOfRange` in the picker's file, `dashboard.leftOut` reused | low | Judgement calls with no named harm | rejected |
| spec | `docs/sure-parity.md` omits that the median nets refunds where Sure's takes gross outflows | low | `IncomeStatement::FamilyStats` classifies by sign | patched |
| verification-gap | The grey « unused » slice is untested | medium | Dropping it passes every test | patched: slice counts and fill in `e2e/budgets.spec.ts` |
| verification-gap | The « Budgets » breadcrumb is untested | medium | Every other `useCrumbs` branch has an assertion | patched |

---
title: 'Story 6.2: Monthly income and expenses by category'
type: 'feature'
created: '2026-09-23'
status: 'ready-for-dev'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-6-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/scaffolding-lessons.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The dashboard shows net worth but not where the month's money came from and went; categories, exclusions and transfer matching feed no report yet (FR35).

**Approach:** A second dashboard card shows a chosen month's income and expense totals and, for each side, one line per top-level category (sub-categories rolled up) with its total and share, plus « Sans catégorie ». Each line links to `/operations` filtered on that category and month.

## Boundaries & Constraints

**Always:**
- A transaction counts when it is not `excluded`, not a transfer side except the outflow of a `loan_payment` or `investment_contribution` (the existing `direction` rule), and its account is in 6.1's counted set: `active`, not `excludedFromReports`, currency `getReportingCurrency()`. Extract that set from `getNetWorth` into one helper in `services/reports.ts` so both cards share it. Other-currency accounts stay named by 6.1's notice only.
- `countsInCashFlow(tx)` joins `direction` in `domain/cash-flow.ts`. Pending does not exist until Epic 10, which adds it to both the function and its SQL twin.
- The SQL lives in `services/ledger.ts` (oxlint lets only the ledger read `entries`, `transactions` and `transfers`): `cashFlowByCategory(deps, { from, to, accountIds })`, built on `filterCondition` with `direction: ["income", "expense"]` plus `excluded = false`, grouped by `category_id` and by amount sign. A parity test ties it to `countsInCashFlow`, as `ledger.spec.ts` already does for `direction`.
- Pure `cashFlowBreakdown(rows, categories)` in `domain/cash-flow.ts`: a sub-category's rows go to its parent; a category line is the signed sum of its rows and sits in its category's `kind` group; uncategorised rows split by sign into « Sans catégorie » under income and under expenses. A zero line is dropped. Lines sort by absolute amount, descending. Share = line / group total, `null` when the total is zero. Group totals are the sums of their lines, so a refund in Courses lowers both Courses and « Dépenses ».
- Month = whole calendar month `YYYY-MM`, `from` its first day, `to` its last, through a new `monthRange` in `domain/dates.ts` (reuse the private `daysInMonth`). Future-dated rows of the month count, so the list opened by a line holds the same rows.
- `GET /api/reports/cash-flow?month=YYYY-MM`, `month` required, parsed by `cashFlowQuerySchema` in new `schemas/reports.ts`. Data: `{ month, from, to, currency, income, expenses, lines: { income: Line[], expense: Line[] } }`, `Line = { categoryId: string | null, name, color, amount, share }`, amounts signed minor units.
- Card « Ce mois-ci » under the net worth card (other months: « Août 2026 »), previous and next month buttons, month in `?month=` (fallback: current month in the browser's zone, next disabled on it). « Revenus » and « Dépenses » totals as labelled groups, as in the mockup. Rows: `CategoryDot` (`null` gives the dashed dot), name, bar scaled to the largest line of its group (`aria-hidden`), share, `<Money>`. Each row is a `Link` to `/operations` with `category: [id]` (`"none"` for « Sans catégorie ») and the month's `from`/`to`. Empty month: « Aucune opération ce mois-ci. ».
- Query key `queryKeys.transactions.cashFlow(month)` = `["transactions", "cash-flow", month]`: every transaction, category-assignment, transfer and account-flag write already invalidates `transactions.all`. Strings under `dashboard.cashFlow` in `locales/fr.json`.

**Never:** no period picker shared with net worth, no custom month start day, no Sankey or donut, no exchange rates, no new transaction-list filter, no change to `direction` or to the list's filters, no migration.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Roll-up | −30 in Courses, −20 in child Bio | One Courses line −50 | — |
| Refund | −80 and +20 in Courses | Courses −60, « Dépenses » −60 | — |
| Uncategorised | +100 and −40 without category | « Sans catégorie » +100 under income, −40 under expenses | — |
| Not counted | Excluded row, `internal_move` both sides, card payment, account excluded from reports, inactive account, USD account | In no total, no line | — |
| Categorised transfer side | Side matched after being put in Courses | Not in Courses | — |
| Month bounds | Rows on the 1st, the last day and the next month's 1st | First two counted | — |
| Zero group | Income lines +50 and −50 | Both lines, share `null` | — |
| Empty month | No counted row | Zeros, empty lines | — |
| Bad month | `?month=2026-13`, missing month | — | 400 `VALIDATION_ERROR` |

</frozen-after-approval>

## Code Map

- `packages/api/src/domain/cash-flow.ts` -- `direction` 26, `CashFlowTransaction` 10; add `countsInCashFlow` and `cashFlowBreakdown`. `domain/dates.ts` -- `daysInMonth` 42, `addMonths` 57.
- `packages/api/src/services/ledger.ts` -- `TransactionFilter` 2482, `categoryCondition` 2524, `isTransferSide` / `DIRECTION_CONDITIONS` 2566-2578, `filterCondition` 2584, `sumTransactions` 2691 and `countByCategory` 1500 as aggregate models. Transfer matching leaves the category in place (2169-2177).
- `packages/api/src/services/reports.ts` -- `getNetWorth` 59, counted-account rule 62-64 to extract. `routes/reports.ts`, `app.ts` 62 -- route already mounted under `/reports`. `services/categories.ts` -- category reads (parent, kind, colour).
- `packages/web/src/routes/_authed.index.tsx` -- `searchSchema` 23, `NetWorthCard` 71, `DashboardPage` 130, `changePeriod` for the `replace: true` navigation. `hooks/useNetWorth.ts` -- model for `useCashFlow`. `lib/query-keys.ts` -- `transactions`. `lib/transaction-filters.ts` -- `operationsSearchSchema` (`category`, `from`, `to`). `components/CategoryDot.tsx`, `components/Money.tsx`, `lib/dates.ts` `toIsoDate`.
- Tests: `domain/cash-flow.spec.ts`; `ledger.spec.ts` 4261-4318 direction parity; `app.spec.ts` `describe("GET /api/reports/net-worth")` 4436 with `netWorthOf`, `openOwn`, `postOwn`, `patchOwn`, `createCategory`, `categorise`, `household()` 4150 for an auto-matched transfer, clock at `2026-09-21`. E2E `e2e/dashboard.spec.ts` (shared database: use a month of its own far in the past), `fixtures.ts` `apiHelpers` (`openAccount` with `openingDate`, `addTransaction`, `excludeTransaction`, `createCategory` with `parentId`, `categorise`, `matchTransfer`).

## Tasks & Acceptance

**Execution:**
- [ ] `packages/api/src/domain/cash-flow.spec.ts`, `domain/dates.spec.ts` -- failing tests for `countsInCashFlow`, `cashFlowBreakdown` (roll-up, refund, uncategorised split, sort, zero line, zero group) and `monthRange` (February, leap year, December).
- [ ] `packages/api/src/domain/cash-flow.ts`, `domain/dates.ts` -- the three functions.
- [ ] `packages/api/src/services/ledger.spec.ts` -- failing parity test for `cashFlowByCategory` against `countsInCashFlow`.
- [ ] `packages/api/src/services/ledger.ts` -- `cashFlowByCategory`.
- [ ] `packages/api/src/app.spec.ts` -- failing `describe("GET /api/reports/cash-flow")` covering every matrix row.
- [ ] `packages/api/src/schemas/reports.ts`, `services/reports.ts`, `routes/reports.ts` -- schema, shared counted-account helper, `getCashFlow`, route.
- [ ] `packages/web/src/hooks/useCashFlow.ts`, `lib/query-keys.ts`, `components/CashFlowCard.tsx`, `routes/_authed.index.tsx`, `locales/fr.json` -- card, month navigation, rows and links.
- [ ] `packages/web/e2e/dashboard.spec.ts`, `e2e/fixtures.ts` -- `excludeAccount` helper, one test per criterion below.

**Acceptance Criteria:**
- Given a month with categorised, excluded, transfer and excluded-account rows, when the dashboard shows it, then « Revenus » and « Dépenses » count only the counted rows.
- Given a parent with a sub-category and an uncategorised expense, when the card shows the month, then the parent line holds both, each line shows its amount and share, and « Sans catégorie » has its own line.
- Given a category line, when I click it, then `/operations` opens with `category` and the month's `from` and `to` in the URL and lists that category's rows.
- Given the card, when I click « Mois précédent », then `?month=` and the heading move back one month.

## Implementation Notes

## Spec Change Log

## Review Triage Log

## Design Notes

Assumptions taken from Sure or the spine rather than asked. Totals come from lines grouped by category `kind` (spine AD-9), where Sure nets each category and files it by sign; both lower a category by its refunds. Share of its own side, amount-descending order and dropped zero lines follow Sure's donut. The drill-down carries only category and dates, as Sure's does: its list can still show excluded rows, transfer sides that kept a category, and rows of accounts excluded from reports, which the card leaves out. Month navigation by arrows is Archant's own choice: the story asks for a month, Sure uses its shared period picker.

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test && pnpm test:e2e` -- expected: all pass, no tracked file modified afterwards.

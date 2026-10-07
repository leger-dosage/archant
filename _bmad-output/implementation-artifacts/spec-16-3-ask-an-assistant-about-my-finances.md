---
title: 'Story 16.3: Ask an assistant about my finances'
type: 'feature'
created: '2026-10-03'
status: 'done'
baseline_commit: '40366c4c727c2f057d9b0a3ec276d9ea2fed4383'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-16-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** An assistant connected through `/api/mcp` reads accounts, transactions and rules, but not the figures the owner asks about in plain words: net worth over time, a month's income and expenses, recurring payments, one transaction in full.

**Approach:** Add four read tools, `get_balance_sheet`, `get_income_statement`, `get_recurring_transactions`, `get_transaction`, and give `get_accounts` an optional balance series. Each reads the service the dashboard, the account page, « Récurrents » or the transaction sheet reads, so a figure never disagrees with the interface. Story 16.3 of `epics.md` is the acceptance contract; this spec adds what reading the code and Sure settled.

## Boundaries & Constraints

**Always:**
- All five tools are `archant:read`, `READ_ONLY`, `changedRows: 0`, inputs as `z.strictObject` in `schemas/assistants.ts`, amounts as `toDecimalString` strings with their currency. Tools returning labels, account or merchant names end their description with `BANK_TEXT`.
- Periods are `BALANCE_PERIODS` (`"1M" | "3M" | "6M" | "1Y" | "all"`), default `"1Y"`, as Sure defaults to the last 365 days.
- Series are sampled as Sure's `Period#interval`: daily up to one year of span, weekly beyond, monthly beyond five years, each bucket keeping its last day, so today stays the last point and equals the headline. One pure function `sampleSeries(points)` in `domain/balances/history.ts` returns `{ interval: "day" | "week" | "month", points }`; it bounds ten years to about 120 points instead of 3,650.
- `get_balance_sheet` calls a new `getBalanceSheet(deps, period)` in `services/reports.ts`, sharing one private computation with `getNetWorth`, whose output stays unchanged. It returns `period`, `from`, `to`, `currency`, `netWorth`, `assets`, `liabilities` (positive), `change` (`amount` string, `percent`), one sampled series each for net worth, assets and liabilities, as Sure's tool does, and `leftOutCount` with `leftOutAccountIds`.
- `get_income_statement` takes `month` (`monthSchema`), default the current month in the server's time zone. It calls `getCashFlow`, which also returns its `leftOut`, an additive field the interface ignores. Output: `month`, `from`, `to`, `currency`, signed `income` and `expenses`, `lines.income` and `lines.expense` (`categoryId`, `name`, `amount`, `share`), `uncategorisedIncome` and `uncategorisedExpense` (`"0.00"` when absent), `leftOutCount`, `leftOutAccountIds`.
- `get_accounts` input becomes `{ includeBalanceSeries?: boolean = false, period?: BalancePeriod = "1Y" }`. Without series it calls `listAccounts` as today. With series it calls a new `listAccountsWithHistory(deps, period)` in `services/balances.ts`, and each account gains `balanceSeries` (`interval`, `points`), empty for an account opened after today.
- `get_recurring_transactions` takes `status`: `"current"` (detected or confirmed, default), `"inactive"` or `"all"` (every status but dismissed, as « Récurrents » lists), and `withinDays` 1–365, keeping next dates from today to today plus that many days, as Sure's `upcoming_within_days`. `listRecurring(deps, filter?)` gains that optional filter; its route calls it without one. The tool returns at most 200 in the service's order, with `total` and `truncated`; each item: `id`, `label`, `merchantId`, `merchantName`, `accountId`, `accountName`, `amount`, `currency`, `status`, `expectedDayOfMonth`, `nextExpectedDate`, `lastOccurrenceDate`, `occurrenceCount`, `manual`.
- `get_transaction` takes `id`. It calls `getTransaction`, the private `found` of `services/transactions.ts` exported under that name. Output: `get_transactions`'s item fields plus `reference`, `transfer` with `counterpartAccountName`, and `source` (`manual`; `import` with `format` and `date`; `bank` with `connector`). An unknown id answers `isError` `NOT_FOUND`.
- `INSTRUCTIONS` gains one line: net worth and income figures count only accounts in the reporting currency; when `leftOutCount` is above zero, say so to the owner.

**Never:** no new route or screen; no change to the dashboard's figures or payloads beyond `getCashFlow`'s additive `leftOut`; no recurring totals (the story asks none); no custom date range; no write.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected |
|---|---|---|
| Same figure | EUR accounts, `get_balance_sheet` `"1M"` | `netWorth`, `assets`, `liabilities` equal `GET /api/reports/net-worth?period=1M` as decimal strings |
| Foreign account | an active, included USD account | left out of every total; `leftOutCount: 1` and its id, in both report tools |
| Long history | ten years, `"all"` | monthly series, last point today equal to `netWorth` |
| Month lines | `get_income_statement` `"2026-09"` | lines and totals equal `GET /api/reports/cash-flow?month=2026-09` |
| Account series | `includeBalanceSeries`, `"3M"` | daily points equal `GET /api/accounts/:id/balances?period=3M` |
| Window | `withinDays: 7`, one due in 3 days, one in 20, one overdue | only the first |
| Unknown id | `get_transaction` with a missing id | `isError`, `NOT_FOUND` |

</frozen-after-approval>

## Code Map

- `packages/api/src/mcp/accounts.ts` -- `getAccounts`, input `noToolInput` today; `mcp/transactions.ts:13-30` item shape to reuse for `get_transaction`; new `mcp/reports.ts`, `mcp/recurring.ts`.
- `packages/api/src/mcp/server.ts:61` `TOOLS` (new reads before `createRuleTool`), `:89` `INSTRUCTIONS`; `mcp/tool.ts` `READ_ONLY`, `BANK_TEXT`, `defineTool`.
- `packages/api/src/schemas/assistants.ts` -- tool inputs; `schemas/balances.ts:8` `BALANCE_PERIODS`; `schemas/reports.ts:4` `monthSchema`.
- `packages/api/src/services/reports.ts:63` `reportedAccounts`, `:81` `getNetWorth`, `:137` `getCashFlow`; `domain/net-worth.ts:18` `netWorthSeries` (a liability series is the sum of liability points, positive).
- `packages/api/src/services/balances.ts:39` `getBalanceHistory`, `PERIOD_MONTHS`; `services/accounts.ts` `listAccounts` (balances imports accounts, so `listAccountsWithHistory` lives in `balances.ts`).
- `packages/api/src/domain/balances/history.ts` -- `periodRange`, `balanceChange`; add `sampleSeries`. `domain/dates.ts` `today`, `monthRange`.
- `packages/api/src/services/recurring.ts:296` `listRecurring`, `RecurringRecord` `:34`; `@archant/data/schema/recurring-transactions` `RECURRING_STATUSES`.
- `packages/api/src/services/transactions.ts:187` `found`; `services/ledger/queries.ts:42-75` `TransactionRecord`, `TransactionSource`, `TransferLink`.
- Tests: `mcp/server.spec.ts` (`READ_TOOLS` `:48`, `callTool`, `spend`), `testing/app.ts` `netWorthOf` `:523`, `cashFlowOf` `:542`, `openAccount`.
- Docs: `docs/deployment.md:301` read tool list, `docs/security-model.md:52` what read access reads.

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/domain/balances/history.spec.ts`, `history.ts` -- `sampleSeries` cases first: empty, under a year, just over one and five years, last point kept, bucket edges.
- [x] `packages/api/src/services/reports.spec.ts`, `reports.ts` -- `getBalanceSheet` totals equal `getNetWorth`, asset and liability series, `leftOut` on `getCashFlow`.
- [x] `packages/api/src/services/balances.spec.ts`, `balances.ts` -- `listAccountsWithHistory`, an account opened after today.
- [x] `packages/api/src/services/recurring.spec.ts`, `recurring.ts` -- each status filter and the window, overdue left out, the route unchanged.
- [x] `packages/api/src/services/transactions.ts` -- export `getTransaction`.
- [x] `packages/api/src/schemas/assistants.ts`, `mcp/reports.ts`, `mcp/recurring.ts`, `mcp/transactions.ts`, `mcp/accounts.ts`, `mcp/server.ts` -- the tools, `TOOLS`, `INSTRUCTIONS`.
- [x] `packages/api/src/mcp/server.spec.ts` -- each matrix row through the handler against the route's figure; every amount a decimal string; `READ_TOOLS` updated.
- [x] `docs/deployment.md`, `docs/security-model.md` -- the new read tools and what they read.

**Acceptance Criteria:**
- Given Story 16.3 of `epics.md`, when the story ships, then each of its criteria holds, with the revisions this spec records.
- Given a read-only token, when `tools/list` runs, then the five tools are listed with `readOnlyHint: true` and an object `outputSchema`.

## Design Notes

Sampling departs from « as the dashboard does » on purpose: the tool text and `structuredContent` both carry the series, so ten years of daily points would cost the assistant tens of thousands of tokens. Sure's rule is kept, and the last point is today, so the headline and the series agree.

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck` -- expected: clean
- `pnpm test` -- expected: green, `sampleSeries` and the recurring filter covered to the branch
- `pnpm test:e2e` -- expected: green, nothing in the interface changed

**Manual checks:**
- Claude Code on a throwaway server: « Quelle est ma valeur nette sur un an ? », « Où est parti mon argent en septembre ? », « Quels prélèvements arrivent cette semaine ? ».

## Implementation Notes

- `classificationSeries` joins `netWorthSeries` in `domain/net-worth.ts`, both built on one private sum, for the assets' and liabilities' series.
- `sampleSeries(points, interval?)` picks Sure's interval by calendar years, `addMonths(first, 12)` and `addMonths(first, 60)`; `getBalanceSheet` samples assets and liabilities at the net worth's interval so the three series share their dates. Weeks run Monday to Sunday.
- `decimal` moved from `mcp/transactions.ts` to `mcp/tool.ts`, beside `seriesOutput` and `seriesOf`, so `mcp/accounts.ts` and `mcp/reports.ts` share them without importing each other.
- `get_transaction`'s `source.format` is a string described as `"ofx"`, `"csv"` or `"qif"`: only the ledger imports the imports schema (AD-2).
- Two cases in `routes/reports.spec.ts` compare the whole `/cash-flow` payload and gain `leftOut: []`; `e2e/assistants.spec.ts` lists the new read tools.
- `pnpm test:e2e` passed in full (323).
- Not done: the manual check with Claude Code on a throwaway server.

## Spec Change Log
- Owner rule of 2026-10-07, settled for the field names: every assistant tool names its input and output fields in snake case, Sure's names where Sure's function has the field, the snake case of Archant's own otherwise, so the server uses one style throughout; a refusal names the tool's field. The HTTP API keeps camel case. KEEP: amounts as decimal strings (money). Here: `get_accounts` takes Sure's `include_balance_series` and `series_period` and answers `historical_balances`; `get_transactions` takes Sure's `account_ids`, `types`, `start_date`, `end_date`, `search` and `page_size`, and `category_ids`, `merchant_ids`, `tag_ids`, `amount_min`, `amount_max`, ids where Sure takes names, and answers Sure's `transactions`, `total_results`, `total_income`, `total_expenses`, each line's label as `name`; `get_recurring_transactions` takes `upcoming_within_days` and answers `recurring_transactions`, `total_results`, `name`, `is_manual`; the reports give `net_worth`, `left_out_count` and `left_out_account_ids`.
- Owner rule of 2026-10-08, the shapes: every assistant tool takes and answers the structure of Sure's assistant function, checked against Sure at `56140319d`; a referenced row is Sure's `{ id, name }`, a paged list gives Sure's `total_results`, `page`, `page_size` and `total_pages`. A read takes Sure's names beside ids. KEEP: a write takes ids where Sure takes a name a bank writes, an account's (AD-19: a connection names an account after the bank, and names repeat); amounts as signed decimal strings (money); a refusal as its code (error contract). Here: `get_accounts` adds `as_of_date`; `get_balance_sheet` groups each figure as Sure's `{ current, monthly_history }`, `net_worth.change` beside, with `as_of_date`, `start_date` and `insights.debt_to_asset_ratio`; `get_income_statement` gives Sure's `period`, `income` and `expense` each with `total` and `by_category`, and `insights` with `net_income` and `savings_rate`, dropping `uncategorised_income` and `uncategorised_expense`, which `by_category` holds; `get_recurring_transactions` gives the active series by default as Sure's, `status` `active`, `inactive` or `all`, each with `account` and `merchant` as `{ id, name }` and its `expected_amount_range`, with `as_of_date` and `totals_by_currency`; `get_holdings` names its `account`; `get_categories`, `get_merchants`, with Sure's `search`, and `get_tags` page as Sure's, 50 by default; `get_categories` lists by hierarchy with `name_with_parent`, `color`, `icon` and `is_subcategory`; `get_budget` takes Sure's "MMM-YYYY" months and groups each month as Sure's `period`, `totals`, `income` and `categories` with their `subcategories`, `color`, `inherits_parent_budget` and, this month, `suggested_daily_spending`, and counts `months_unavailable`.

## Review Triage Log

| Layer | Finding | Verdict | Evidence | Route |
|---|---|---|---|---|
| blind, edge | The three balance sheet series can sample at different intervals, so they do not line up point by point | medium | `getBalanceSheet` calls `sampleSeries` on each series; a liability opened two years ago samples weekly under a monthly net worth | patched: assets and liabilities take the net worth's interval |
| blind | `sampleSeries` counts fixed day spans where Sure's `Period#interval` compares calendar years | low | `DAILY_MAX_SPAN = 366`, `WEEKLY_MAX_SPAN = 1827` against `advance(years: 1)` and `advance(years: 5)` | patched: compares with `addMonths(first, 12)` and `addMonths(first, 60)` |
| verification-gap | No test puts a series due today inside the `withinDays` window | medium | `recurring.spec.ts` and `server.spec.ts` dates avoid today; an exclusive lower bound passes both | patched: a series due today kept with `withinDays: 1` |
| blind, edge | `from` is described as the series' first day, which a sampled series no longer starts on | low | `mcp/reports.ts` `from` description | patched: described as the period's first day |
| blind | `change.percent` described as percentage points | low | `balanceChange` returns a relative percent with one decimal | patched |
| blind | `seriesOutput.interval` description reads ambiguously | low | `mcp/reports.ts` | patched: one clause per interval |
| blind | `period` without `includeBalanceSeries` is ignored silently | low | `getAccountsInput` | patched: its description says it applies only with `includeBalanceSeries` |
| blind | `listAccountsWithHistory` comment says "a few hundred points" | low | Elsewhere about 120 for ten years | patched |
| blind | Sampling drops the period's first day, so `change` cannot be recomputed from the series | low | `change` and `from` are returned beside the series; the spec keeps each bucket's last day | rejected |
| blind | `get_recurring_transactions` gives no `asOf` date | low | The assistants Archant supports carry the date; overdue series are visible by date | rejected: adds output surface for a rare need |
| blind | `get_transaction`'s `import` and `bank` sources never pass the output schema in a test | false | The tool's `result` is typed `z.input` of the output, so a diverging `TransactionSource` fails `pnpm typecheck` | rejected |
| blind | The 201-series test writes into the file's shared database and asserts `>= 201` | low | Test hygiene only; later tests filter their own rows | rejected |
| blind | `docs/deployment.md` omits the 200 cap and the window's overdue rule | low | The tool descriptions state both | rejected |
| blind | Spec and sprint status disagree; notes empty | false | Mid-workflow states; completion sets both | rejected |
| blind | `listAccountsWithHistory` reads each account's whole history for `all` | low | `getNetWorth` reads the same for the dashboard; a household holds few accounts | rejected |
| edge | `withinDays` with `inactive` or `all` matches a stopped series' stored next date | low | Sure's tool applies the window after the status filter the same way; the caller asked for inactive series | rejected: mirrors Sure |

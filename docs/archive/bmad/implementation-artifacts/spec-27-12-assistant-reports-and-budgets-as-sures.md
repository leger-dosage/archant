---
title: "Story 27.12: Assistant reports and budgets as Sure's"
type: 'feature'
created: '2026-10-11'
status: 'done'
baseline_commit: '9593a7e2fd1b8ae55b50f9dd5c6a37cf3e4b3017'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-27-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-27-11-assistant-holdings-and-balance-snapshots-as-sures.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `get_income_statement`, `get_balance_sheet`, `get_budget` and `update_budget` still answer two-decimal signed strings (`"-1024.20"`), numeric percentages, `category_id`, `change`, `carried`, an `uncategorised` block and `left_out_*`, where Sure's functions (`origin/main` `7e1d93613`, unchanged since `00dd977fb`) answer `Money#format` strings, positive expenses, `number_to_percentage` strings, names only and their own refusals. `update_budget` refuses a JSON number.

**Approach:** Each tool answers its Sure function key by key with 27.9's `formatMoney`, `percentage` and `refuse`; numbers are read through `sureDecimalText`. Figures keep coming from Story 27.6's gross view and the budget service; only the serialised shape changes.

## Boundaries & Constraints

**Always:**
- `get_income_statement`, full: `currency`, `period`, `income` and `expense` `{ total, by_category }`, `insights { net_income, savings_rate, median_monthly_income, median_monthly_expenses, avg_monthly_expenses }`; with `account_ids`: `account_ids`, sides with `by_category: null`, `net`, `breakdown_omitted_reason`, no `insights`. Every money field `formatMoney`, positive except `net`, `net_income` and change amounts, which are income minus expenses and may be negative. `by_category`: every top-level category of the household, whatever its kind, on both sides, zero included, then Sure's `fr.yml` lines « Non catégorisé » and « Autres investissements », the latter always zero as Sure's; sorted by total descending, ties by name; each `{ name, total, percentage_of_total, subcategory_totals }`, each subcategory `{ name, total, percentage_of_total }`, every subcategory listed, zero included, the uncategorised line with none. `percentage_of_total` is `percentage(line / side total × 100, 1)`, `"0,0%"` for a zero line. `savings_rate` is `percentage(net / income × 100 rounded to 2 decimals, 3)`, `"0,000%"` without income. Medians and average positive. `monthly_series` and `previous_period` items `{ start_date, end_date, income, expenses, net }` formatted; `income_change`/`expenses_change` `{ amount: formatMoney(delta), percent: number one decimal | null }`. `category_id` goes.
- `get_balance_sheet`: `as_of_date`, `oldest_account_start_date`, `currency`, `net_worth`/`assets`/`liabilities` `{ current: formatMoney, monthly_history }`, `insights { debt_to_asset_ratio }`. `monthly_history` is `{ start_date, end_date, interval, currency, values }` with `values` JSON numbers (`Number` of the decimal text), liabilities' values negative, and `[]` for a range starting today. `debt_to_asset_ratio` is `percentage(liabilities / assets × 100, 0)`: `"0%"` without liabilities, `"Inf%"` with liabilities and no assets. `net_worth.change` goes; `getBalanceSheet` stops computing it.
- `get_budget`: `{ currency, months, months_unavailable? }`; each month `month` (Sure's `to_param`, `"aug-2026"`), `period`, `is_current`, `initialized`, `totals` and `income` formatted, never `null` (a missing amount counts 0), `percent_of_budget_spent` `percentage(…, 1)`, 0 until set up, `overage_percent` `percentage(|available_to_spend| / actual_spending × 100, 1)` when `available_to_spend < 0`, else `"0,0%"`. Category keys in Sure's order: `name`, `budgeted` (a shared child shows its parent's amount, as `display_budgeted_spending`), `actual`, `available`, `percent_spent` (string), `status`, `suggested_daily_spending` (current month, money left), then `color` and `subcategories`, each child ending with `inherits_parent_budget`. `category_id`, `carried`, `rollover_enabled` and `uncategorised` go.
- `update_budget`: `budgeted_spending`, `expected_income` and each `amount` a JSON number or decimal string. Refusals `{ success: false, error, message }` in Sure's order: `no_changes`; `invalid_params` `Invalid month: <m>. Use YYYY-MM or MMM-YYYY.`; `invalid_month`; `invalid_params` `<label> must be a non-negative number.`, `Each categories entry needs a category name or id.`, `'<ref>' is the unallocated remainder of budgeted_spending…` (« Non catégorisé », « Uncategorized » or « Sans catégorie », case aside), `Category '<ref>' not found. Use get_categories to list categories.`, `No budget row exists for category '<name>' in <month>.` (a non-expense category). Archant-only refusals (month not set up, duplicate entry, too many decimals) answer `validation_failed`. Answer `{ success: true, month, totals { budgeted_spending, expected_income, allocated_spending, available_to_allocate }, updated_categories [{ category, budgeted_spending }], message }`, subcategories before parents, message `Budget for August 2026 updated.`.
- Reports' refusals as Sure's, without `success`: `invalid_date` (`Dates must be valid and in YYYY-MM-DD format.`, and `start_date must be on or before end_date.` for a reversed range), `too_many_periods`, `too_many_points`, `unknown_account_ids` with `unknown_ids`. `get_balance_sheet` reads an unknown `period` or `interval` as its default, as Sure.
- Docs: AD-19 says only 27.13 and 27.14 still answer earlier fields; `INSTRUCTIONS`, `docs/deployment.md` « Connecting an assistant », `docs/sure-parity.md` (Budgets, Cash flow, Assistant tools rows set to Parity with their departures) follow.

- « Non catégorisé » joins `UNCATEGORISED_NAMES`, so a name `get_income_statement` gives filters `get_transactions` and `group_transactions_by_label` too.

**Never:** no change to the budget page, `routes/budgets.ts`, `routes/reports.ts`, `grossCashFlow` or the set-up rule; no migration; budgets keep expense categories only; no change to bills, recurring, goals, rules, imports or transfers tools.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Quarter | 1 024,20 € spent | `expense.total: "1 024,20 €"`, income category at `"0,00 €"`, `"0,0%"` | none |
| No assets | liabilities 5 000 | `debt_to_asset_ratio: "Inf%"` | none |
| Over budget | budget 1 000, spent 1 250 | `overage_percent: "20,0%"`, `available_to_spend: "-250,00 €"` | none |
| Not set up | month without row | `budgeted_spending: "0,00 €"`, `percent_of_budget_spent: "0,0%"` | none |
| Number amount | October 2026 set up, `budgeted_spending: 6500` | stored 650000, `message: "Budget for October 2026 updated."` | none |
| Negative | `amount: -5` | nothing written | `invalid_params`, `amount for 'Courses' must be a non-negative number.` |

</frozen-after-approval>

## Code Map

- `packages/api/src/mcp/reports.ts` -- both report tools; `decimal`, `leftOutFields`, `leftOutOf`, `percentOf`, `shareOf` go. Sure: `get_income_statement.rb` `to_ai_category_totals`, `get_insights`; `get_balance_sheet.rb` `insights_data`; `assistant/function.rb:130` `to_ai_time_series`.
- `packages/api/src/services/reports.ts:182-261` -- `BalanceSheet.change` and its `balanceChange` call go (`services/reports.spec.ts:138,168` follow); `:429-561` `getIncomeStatement`: its breakdown drops zero lines (`domain/cash-flow.ts:138,242`); add the household's top-level categories and their children at zero in the tool or the service, never in `grossCashFlow`, which budgets share. `CashFlowLine.share` is a fraction; expense amounts are negative (AD-5): take absolute values at the boundary.
- `packages/api/src/mcp/budgets.ts` -- both budget tools; `monthOf` reshaped. Inputs: `BudgetMonth`, `BudgetCategoryLine` (`domain/budgets/categories.ts:16-62`; `shared`, `parentId`, `percentSpent`, `available`).
- `packages/api/src/services/budgets.ts:664` `updateBudget` takes decimal text, refuses with its own field codes (`schemas/budgets.ts:99-150`); unchanged. `services/names.ts` `categoryIdsOf` resolves names.
- `packages/api/src/schemas/assistants.ts:118-143` `toolMonth`/`MONTH_ABBREVIATIONS` (reuse for the `to_param` slug); `:165-242` report inputs made loose where Sure checks in `call`; `:1016-1076` budget inputs, amounts through `sureAmount` (`:1297`), `month` loose in `update_budget`.
- `packages/api/src/mcp/tool.ts` -- `formatMoney:255`, `percentage:270` (must write `"Inf%"` for `Infinity`), `refuse:193`, `refuseWithoutSuccess:198`, `sureDecimalText:316`, `SURE_REFUSALS:150`. `decimal` stays (goals, imports, recurring, transfers, transactions), `leftOutFields`/`leftOutOf` stay (bills).
- `packages/api/src/services/names.ts:17` -- `UNCATEGORISED_NAMES`, read by the name filters and `categoryIdsOf`.
- `packages/api/src/mcp/server.ts:142,146,183-185` -- `INSTRUCTIONS`: amount formats, the budget's uncategorised remainder no longer listed.
- Tests: `mcp/reports.spec.ts`, `mcp/server.spec.ts:1098-1312` and `:2505-3085`, `services/reports.spec.ts`.
- Docs: `docs/architecture.md:197-201`, `docs/deployment.md:321,335`, `docs/sure-parity.md:234,244,252`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/mcp/reports.spec.ts`, `mcp/server.spec.ts` -- failing first: each matrix row, `Object.keys` of every answer, category and month, every refusal message and order, `"Inf%"`, `"0%"`, the overage formula, zero categories on both sides.
- [x] `packages/api/src/mcp/tool.ts` -- `percentage` for non-finite values, with its unit test in `tool.spec.ts`.
- [x] `packages/api/src/services/reports.ts`, `services/reports.spec.ts` -- drop `change`; expose what the zero lines need.
- [x] `packages/api/src/schemas/assistants.ts`, `mcp/reports.ts`, `mcp/budgets.ts` -- inputs, answers, refusals.
- [x] `packages/api/src/services/names.ts` -- « Non catégorisé » in `UNCATEGORISED_NAMES`, with a filter case in `mcp/transactions.spec.ts`.
- [x] `packages/api/src/mcp/server.ts` -- `INSTRUCTIONS`, `schemas/assistants.ts:348` description.
- [x] Docs as Boundaries list; `sprint-status.yaml` key `27-12-assistant-reports-and-budgets-as-sures`.

**Acceptance Criteria:**
- Given `pnpm test`, when both Vitest projects run, then they pass and the four tools are pinned key by key through the MCP handler.
- Given `pnpm lint:code`, when knip runs, then nothing this story leaves unused remains.
- Given the budget and dashboard pages, when they load, then they show what they showed before this story.

## Design Notes

Sure's `weight` divides by the whole side's total, subcategory rows included, so a subcategory's share is of the side, as today. Sure's `savings_rate` rounds to 2 decimals then prints at `number_to_percentage`'s default precision 3: `"12,340%"`.

`months_unavailable` keeps Archant's count: Sure lists a prior month only when its `budgets` row exists, a row its page creates on view; Archant writes no row on read, so listing every month in range is the nearest equivalent.

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck` -- expected: clean.
- `pnpm test` -- expected: both Vitest projects pass.
- `pnpm test:e2e` -- expected: green.

## Implementation Notes

- The report services keep throwing `AppError`; `mcp/reports.ts` maps their `unknown_account`, `too_many_periods` and `too_many_points` field codes to Sure's keys without `success`, `unknown_ids` read back from `account_ids` by index, each id once.
- `getIncomeStatement`'s breakdown carries the household's categories; the tool adds the zero lines, so `grossCashFlow` is unchanged. `getBalanceSheet` and `getIncomeStatement` no longer return `change` or `leftOut`.
- `update_budget` checks the month, the amounts and each category in the tool, in Sure's order, before `updateBudget`, through `isBudgetableMonth` (new in `services/budgets.ts`) and `categoriesByRef` (new in `services/names.ts`, id then name case aside); `updateBudget` is unchanged and its own refusals answer `validation_failed`.
- `percentage` writes `"Inf%"`, `"-Inf%"` and `"NaN%"`; `monthParam` in `schemas/assistants.ts` writes Sure's `to_param` slug.
- `change_stats`' `percent` follows Sure's type, a `BigDecimal` Rails writes as a string (`"12.5"`, `"-3.0"`), `null` without a previous figure: the frozen line's « number one decimal » was wrong about Sure. It and `savings_rate`'s two-decimal rounding come from `percentDecimal` (`mcp/tool.ts`), half up on the exact ratio of the minor-unit integers, never a float. `formatted` and `percent` schema factories live in `mcp/tool.ts`; `sureMonthOf` in `schemas/assistants.ts` is the one month reader; `categoryIdsOf` lost its `caseInsensitive` option, the bill tools being its only caller.
- « Non catégorisé » in `UNCATEGORISED_NAMES` also reaches the bill tools' `category_name`, through `categoryIdsOf`: it clears a bill's category as « Uncategorized » already did. Accepted: one list of uncategorised names, read the same everywhere.
- `update_budget` asks `isBudgetableMonth` before `updateBudget` to refuse `invalid_month` in Sure's order; AD-19 names that second call.
- Story 27.12's text in `epics.md` names « Non catégorisé », the owner's answer to the plan's only question.

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Evidence | Route |
|---------|---------|----------|-------|
| `change_stats` `percent` a JSON number (own reading, blind) | medium | Sure's `delta` is a `BigDecimal`, `BigDecimal / Float` stays one, `round(1)` keeps it, Rails writes it as a string; the frozen line was wrong about Sure's type. | patch: `percentDecimal` |
| `rounded` rounds a float, a half may tip (blind) | low | `Math.round(abs × 10²)` on a binary fraction; Sure rounds a `BigDecimal` half up. | patch (same helper) |
| `monthOfParam` re-implements `toolMonth`'s abbreviations (blind) | medium | Two abbreviation tables would let `get_budget` and `update_budget` read a month differently. | patch: `sureMonthOf` |
| `formatted`/`percent` copied in two tools (blind) | low | Identical factories in `reports.ts` and `budgets.ts`; one description change would diverge. | patch: moved to `tool.ts` |
| `categoryIdsOf` doc names `update_budget`, dead `caseInsensitive` (blind, verification-gap) | low | Its one caller, `bills.ts:182`, passes `false`. | patch |
| Refusal order pinned for few pairs (verification-gap) | medium | Pre-verified gap: moving `monthOfParam` or the totals' `amountText` failed no assertion. | patch: two calls |
| « Non catégorisé » now clears a bill's category (blind, verification-gap) | low | Same meaning « Uncategorized » already has in `category_name`; the shared constant is the story's decision. | rejected |
| A real category named « Non catégorisé » or « Autres investissements » collides (blind, edge) | low | Sure has the same collision with a real « Uncategorized »; a guard adds a branch for a name nobody creates. | rejected |
| Not set up with spending: `overage_percent` 100 % beside 0 % spent (blind) | false | Sure's `available_to_spend` is `(nil \|\| 0) − actual`, negative, so `overage_percent` is 100 too, and `percent_of_budget_spent` 0 when not `initialized?`. | rejected |
| `validation_failed` messages carry field codes (blind) | low | Archant-only refusals; a sentence table adds a mapping for three rare cases. | rejected |
| `historyOf` repeats the service's today test (blind) | low | The service documents the empty series for a range starting today; no named divergence. | rejected |
| `asSure` reads ids back from `accountIds.N` paths (blind) | low | The service writes that path in the same story; a change there fails `reports.spec.ts`. | rejected |
| `categoriesByRef` picks the first of two names equal case aside (blind, edge) | low | Sure's `where(LOWER(name) = ?).first` is unordered too. | rejected |
| `left_out_*` gone, no warning in `INSTRUCTIONS` (blind) | false | The epic removes them; each report's description says other currencies are left out. | rejected |
| JSON `null` amount answers a schema error (edge) | low | Sure answers `invalid_params`; no assistant sends a null amount. | rejected |
| `Date.parse` accepts `2026-8-1`, `z.iso.date` does not (edge) | low | Both tools document `YYYY-MM-DD`; carried from 27.11's triage. | rejected |
| `account_ids: []` refused (edge) | low | Sure's own schema declares `minItems: 1`. | rejected |
| Non-ASCII case fold differs from SQLite `lower` (edge) | low | Folded in JavaScript, not SQL; `École`/`école` twins are not a real household. | rejected |
| `1e3` refused as `invalid_params` (edge) | low | Carried from 27.10: exponent amounts are never a budget. | rejected |
| Money helpers typed `number` (spec-review, standards) | medium | AGENTS.md: a bare `number` meaning money is a bug; the base code typed them `MinorUnits`. | patch |
| `update_budget` calls two services against AD-19 (spec-review, standards) | low | `isBudgetableMonth` reads bounds so `invalid_month` precedes the amount checks, as Sure. | patch: AD-19 names it |
| Percentages divided as floats beside `percentDecimal` (spec-review, standards) | low | `percentage` rounds from the shortest decimal text, so float noise vanishes; only `savings_rate`'s double rounding needed exact maths. | rejected |
| Two category lookups in `names.ts` (spec-review, standards) | low | `categoryIdsOf` is exact for bills, `categoriesByRef` case-blind as Sure's `update_budget`; one function would take back the removed option. | rejected |
| `asSure` and `asValidationFailed` share a try/catch shape (spec-review, standards) | low | Different codes, keys and messages; a shared helper takes a mapping for two callers. | rejected |
| `monthParam` formats output from `schemas/` (spec-review, standards) | low | It sits beside `MONTH_ABBREVIATIONS`, the one list both directions need. | rejected |
| `percentage(0, 0)` unnamed (spec-review, standards) | low | Reads as Sure's `number_to_percentage(0, precision: 0)`. | rejected |
| `sure-parity.md` rows keep a mixed status (spec-review, spec) | low | Each row covers more than these tools; their 27.12 clauses say Parity. | rejected |
| Story text says « Uncategorized » (spec-review, spec) | low | The owner chose « Non catégorisé » at planning. | patch: `epics.md` |
| `get_budget` refuses a month out of range (spec-review, spec) | low | Pre-existing, recorded in `sure-parity.md`. | rejected |
| Subcategories sorted largest first (spec-review, spec) | low | Sure's order is its query's, unordered; a stable order is not a departure an assistant notices. | rejected |

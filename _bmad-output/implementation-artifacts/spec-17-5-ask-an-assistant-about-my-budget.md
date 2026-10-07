---
title: 'Story 17.5: Ask an assistant about my budget'
type: 'feature'
created: '2026-10-03'
status: 'done'
route: 'dispatch'
baseline_commit: 'db38152a3bbca841a11b9f7e63c4e734617e6bba'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-17-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** An assistant connected through `/api/mcp` cannot read a month's budget nor set its amounts, so the owner cannot plan a month in conversation; Epic 16 left budgets out because Archant had none.

**Approach:** Add `get_budget` (`archant:read`) and `update_budget` (`archant:write`), after Sure's `GetBudget` and `UpdateBudget` (read at `14638a701`). `get_budget` calls `getBudget`, the page's own function, once per month; `update_budget` calls a new `updateBudget` in `services/budgets.ts` that runs, in one transaction, the same writes `saveBudget` and `saveCategoryBudget` run. Story 17.5 of `epics.md` is the acceptance contract; this spec adds what reading the code settled.

## Boundaries & Constraints

**Always:**
- Tools in a new `mcp/budgets.ts`, inputs as `z.strictObject`s in `schemas/assistants.ts`; `getBudgetTool` after `getIncomeStatement` and `updateBudgetTool` last in `TOOLS`.
- `get_budget` takes `month` (`monthSchema`, the current month when absent) and `priorMonths` (integer 0–11, default 0, as Sure's `prior_months`). It calls `getBudget` for `month` first, then for each earlier month inside the returned `bounds`; earlier months outside are dropped, as Sure's. A target out of bounds is `getBudget`'s `NOT_FOUND`. Months oldest first.
- Each month: `month`, `from`, `to`, `currency`, `setUp`, `budgetedSpending` and `expectedIncome` (nullable decimals), `allocated`, `actualSpending`, `actualIncome`, `categories` and `uncategorised`. Each category: `categoryId`, `parentId`, `name`, `budgeted` (stored amount, a parent's including its ring-fenced subcategories), `shared`, `carried` (`rolledOver`), `actual` (`spent`), `available`, `percentSpent` (one decimal), `rolloverEnabled`, `status`. `uncategorised`: `budgeted` (what the total leaves unallocated), `actual`, `available`, `status`, no id. `leftOutCount` and `leftOutAccountIds` once, from the target month, through `leftOutFields` exported from `mcp/reports.ts`.
- `status` is Sure's `category_status` read from the envelope: not `budgeted` → `unbudgeted` when it spent, else `no_activity`; otherwise `over` → `over_budget`, `near` → `near_limit`, `onTrack` → `on_track`.
- `update_budget` takes `month` (required: a write names its month), `budgetedSpending`, `expectedIncome` and `categories` (`{ categoryId, budgeted }[]`), each optional, amounts as decimal strings parsed in the reporting currency by the rules of `budgetSchema` and `budgetCategorySchema` (blank is 0, a subcategory at 0 shares its parent's). Nothing given answers `empty_patch`; an id twice answers `duplicate` on that entry's `categoryId`; a `null` `categoryId`, « Sans catégorie », answers `uncategorised`.
- `updateBudget` opens one `immediate` transaction: bounds check, then the total and income (a field absent keeps its stored value; on a month not set up both are required, as the form, `required` on the missing one; a first set-up inherits rollover switches), then the categories, subcategories first and parents last as Sure's, each through `saveCategoryBudget`'s write and parent sync, then `refreshRollover` once. A category amount on a month not set up is `BUDGET_NOT_SET_UP`; an id that is not an expense category is `NOT_FOUND`; any refusal writes nothing.
- `update_budget` returns the month as `get_budget` shows it, with the left-out fields; annotations `REPLACES`; `changedRows` is 1 when the total or income is given, plus one per category entry.
- `INSTRUCTIONS` gains: « Sans catégorie » is what the total leaves unallocated, set through the total or the category amounts; before `update_budget`, tell the owner the amounts and wait for their agreement.

**Never:** no new route or screen; no copy, move or rollover tool (Sure has none); no lookup by category name (Archant's tools take ids); no write from `get_budget`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected |
|---|---|---|
| Five statuses | September set up; categories over, at 95 %, under, unbudgeted spending, untouched | `over_budget`, `near_limit`, `on_track`, `unbudgeted`, `no_activity` |
| Same figures | any month | each amount equals `GET /api/budgets/:month`'s, as a decimal string |
| Carry | rollover on in August with money left, September set up | September's `carried` is what August left |
| Prior months | `priorMonths: 11` near the lower bound | months before `bounds.from` absent, oldest first |
| Not set up | a month without a total | `setUp: false`, `budgetedSpending: null` |
| Out of bounds | three years ahead | `isError` `NOT_FOUND` |
| First set-up | total, income and categories on a new month | set up, amounts stored, a switch inherited |
| Partial | `expectedIncome` alone on a month set up | total unchanged |
| Missing half | `budgetedSpending` alone on a new month | `VALIDATION_ERROR` `required` on `expectedIncome`, nothing written |
| Child and parent | parent 500 and its child 200 in one call | parent 500, child 200 |
| Uncategorised | `categoryId: null` | `VALIDATION_ERROR` `uncategorised`, nothing written |
| Income category | total and an income category's id | `NOT_FOUND`, total unchanged |
| Read-only token | `update_budget` | `403 insufficient_scope`, recorded, nothing written |

</frozen-after-approval>

## Code Map

- `packages/api/src/services/budgets.ts` -- `getBudget` (l.338, never writes, `NOT_FOUND` out of bounds), `saveBudget` (l.406), `saveCategoryBudget` (l.499), `setUpBudget`, `inheritRollover`, `refreshRollover`, `writeAmount`, `notExpense`, `budgetMonths`. Extract the bodies of `saveBudget` and `saveCategoryBudget` into helpers taking `tx`, called by both and by the new `updateBudget`.
- `packages/api/src/schemas/budgets.ts` -- `plannedAmount`, `budgetCategorySchema`: add `budgetUpdateSchema(currency)` and `BudgetUpdateInput`.
- `packages/api/src/domain/budgets/categories.ts` -- `BudgetCategoryLine`, `UncategorisedLine`, `BudgetStatus`: read only.
- `packages/api/src/mcp/reports.ts` -- `getIncomeStatement`, the golden read tool; export `leftOutFields` and `leftOutOf`.
- `packages/api/src/mcp/tool.ts` -- `READ_ONLY`, `REPLACES`, `decimal`, `defineTool`.
- `packages/api/src/mcp/server.ts:69` `TOOLS`, `:106` `INSTRUCTIONS`.
- `packages/api/src/schemas/assistants.ts` -- `incomeStatementInput` (month pattern), `updateTransactionInput` (`empty_patch`).
- `packages/api/src/mcp/server.spec.ts` -- `READ_TOOLS`, `WRITE_TOOLS`, the hints map (l.335), `writer()`, `callsRecorded`, `outcomes`, `routeData`; `testing/app.ts` clock 2026-09-21.
- `packages/app/src/locales/fr.json:1230` scope labels; `packages/app/e2e/assistants.spec.ts:231`.
- Docs: `docs/deployment.md:296-305`, `docs/security-model.md:52`, `docs/sure-parity.md:217`, `epics.md:3039` (Epic 16's list).

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/mcp/server.spec.ts` -- first: every matrix row through the handler, tool lists and hints updated, each call recorded with its count.
- [x] `packages/api/src/schemas/budgets.ts`, `services/budgets.ts` -- `budgetUpdateSchema`, helpers extracted, `updateBudget`; `routes/budgets.spec.ts` stays green unchanged.
- [x] `packages/api/src/schemas/assistants.ts`, `mcp/budgets.ts`, `mcp/reports.ts`, `mcp/server.ts` -- inputs, tools, `TOOLS`, `INSTRUCTIONS`.
- [x] `packages/app/src/locales/fr.json`, `e2e/assistants.spec.ts` -- the scope labels name budgets.
- [x] Docs in the Code Map; `sprint-status.yaml` (`17-5` and `epic-17` done).

**Acceptance Criteria:**
- Given Story 17.5 of `epics.md`, when the story ships, then each of its criteria holds, with the decisions this spec records.
- Given a write token, when `tools/list` runs, then `update_budget` is listed with `destructiveHint: true` and an object `outputSchema`, and `get_budget` read-only to any token.

## Design Notes

Decisions taken alone:
- `get_budget` loops over `getBudget` rather than a new multi-month service: NFR19 asks for the interface's own function, and a month then reads the same on the page and in the tool. Each call reads the history before its month, so twelve months cost twelve such reads; an assistant call is not on the page's path.
- `update_budget` gets one service function, not a sequence of `saveBudget` and `saveCategoryBudget` calls: AD-19 wants one call per tool, and Sure's `UpdateBudget` writes in one transaction, so a refused category leaves the total as it was. The helpers keep every rule in one place.
- Sure bootstraps a month on any update; Archant keeps the form's rule that a month is set up by its total and income together, so a half set-up month never exists.
- Sure omits « Sans catégorie »; Archant shows it beside the categories, since it holds the unallocated money and the uncategorised spending, without an id.
- The consent labels name budgets, since the write scope now changes them.

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck` -- expected: clean
- `pnpm test` -- expected: green
- `pnpm test:e2e` -- expected: green, the consent labels updated

## Implementation Notes

- The refusals of an empty call (`empty_patch`), a category twice (`duplicate`) and a `null` id (`uncategorised`) live in `budgetUpdateSchema`, the service's schema, so any later caller of `updateBudget` gets them; the tool's input only shapes the call.
- `saveBudget` and `saveCategoryBudget` now call `writeTotals` and `writeCategoryAmount`, the helpers `updateBudget` calls; `routes/budgets.spec.ts` passes unchanged.
- The MCP budget tests each open a household of their own through `ownDatabase`: a budget counts every row of its month, which the file's other tests share.
- Measured on the volume seed (100,000 rows over ten years): one `getBudget` takes about 170 ms, so `get_budget` with `priorMonths: 11` about 2 s, in parallel or in sequence alike. Kept: the page's own function, on a path the page does not take.
- `prettier` realigned the whole parity table of `docs/sure-parity.md` for one changed row.

## Spec Change Log
- Owner rule of 2026-10-07, settled for the field names: every assistant tool names its input and output fields in snake case, Sure's names where Sure's function has the field, the snake case of Archant's own otherwise, so the server uses one style throughout; a refusal names the tool's field. The HTTP API keeps camel case. KEEP: amounts as decimal strings (money). Here: `get_budget` takes `prior_months` and answers `budgeted_spending`, `expected_income`, `actual_spending`, `actual_income`, `percent_spent`, `rollover_enabled` and Sure's `initialized` for a month set up; `update_budget` takes `budgeted_spending`, `expected_income` and categories as `{ category_id, amount }`, Sure's `amount`.

## Review Triage Log

| Layer | Finding | Verdict | Evidence | Route |
|---|---|---|---|---|
| blind | `categories` has no length cap | false | Each entry must be a distinct expense category or the call is refused before any write, so writes are bounded by the household's categories; the 64 KB body limit bounds the `inArray` | rejected |
| blind | `get_budget` does not expose `bounds` | low | The assistant learns the upper bound only from `NOT_FOUND`, whose message says why | rejected: an output field for a rare case |
| blind, standards | `changedRows` counts rows set, not the parent sync, inherited switches or carries rewritten | low | As 16.4's `rename_*` record 1; the formula is in the spec | rejected: a new service result for an informational count |
| blind | `update_budget` runs through a new service function, `get_budget` calls `getBudget` up to twelve times | false | `updateBudget` runs the interface's own writes, `getBudget` is the page's function; both recorded in Design Notes | rejected |
| blind | Twelve `getBudget` calls cost and run outside one read | low | Measured about 2 s at 100,000 rows; a write landing between two reads needs a second writer in one household | rejected: noted in Implementation Notes |
| blind | Assistants already granted `archant:write` gain budget writes without new consent | low | The same held for 16.4's classification tools; the consent label now names budgets | rejected: said in the pull request |
| blind | `security-model.md` omits budget amounts among what a misleading label can make a writer change | low | One sentence | patched |
| blind | No test of a first set-up rolled back by a refused category, nor of `update_budget` out of bounds | low | The income-category test runs on a month set up | patched: both added to the refusals test |
| blind | No MCP test of a shared subcategory at `""`, a parent lifted, `unbudgeted` « Sans catégorie », a non-zero `leftOutCount` | low | Each runs through `saveCategoryBudget`'s and `getBudget`'s code, covered in `routes/budgets.spec.ts` and the domain specs | rejected |
| blind, spec | Spec status and sprint status disagree; a task unchecked | false | Mid-workflow states; completion sets both | rejected; the box ticked |
| blind | `.nullable().describe()` puts a second description on nullable decimals | low | `get_balance_sheet`'s `change` does the same | rejected |
| blind | Local `BudgetStatus` and `statusOf` share names with the domain's | low | The domain's type is not exported; each file reads alone | rejected |
| blind | The parity row omits that the tool takes ids where Sure's also takes names | low | One clause | patched |
| blind, verification-gap | `percentSpent`'s rounding is never observed | medium | Every percentage in the tests is whole | patched: 33.33 on 100.00 asserts 33.3 |
| edge | Category amounts above the total are accepted | false | The page's service accepts them too, as Sure's `UpdateBudget` | rejected |
| edge | `NOT_FOUND` does not name the refused entry | low | The frozen matrix fixes `NOT_FOUND`, the interface's code | rejected |
| edge | The oldest entry deleted between two reads makes a prior month `NOT_FOUND` | low | Needs a delete of a line older than two years during the call | rejected |
| verification-gap | Nothing checks that `update_budget` stores the carry | medium | Deleting `refreshRollover` from `updateBudget` keeps every test green | patched: a test reads `rolled_over_amount` |
| standards | `storedAmount` takes a bare `number` meaning money | medium | AGENTS.md: such a signature is a bug | patched: converted inline |
| standards | `writeTotals` types the currency `string` | low | `getReportingCurrency` returns `CurrencyCode` | patched |
| standards | `entries` names category amounts beside the ledger's `entries` table | low | Rename | patched |
| standards | The tool repeats the bounds check | low | `isBudgetMonth` exists | patched |
| standards | The current-month default and its description repeat `get_income_statement`'s | low | Two lines, as 16.3's tools | rejected |
| standards | `leftOutFields` exported from `reports.ts` for another tool file | low | Shared tool helpers live in `tool.ts` | patched: moved |
| spec | The « Sans catégorie » line of `INSTRUCTIONS` is not asserted | low | One assertion | patched |

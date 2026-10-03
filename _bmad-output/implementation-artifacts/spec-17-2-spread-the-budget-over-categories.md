---
title: "Story 17.2: Spread the budget over categories"
type: 'feature'
created: '2026-10-03'
status: 'done'
route: 'dispatch'
baseline_commit: '3dc2cb73c322d4a3d9e5ab852a4a2ca124f9bd74'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-17-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A month's budget is one total: the owner cannot say how much each expense category may take, nor see which category overflows.

**Approach:** A `budget_categories` table, one amount per expense category and month, edited in a second step « Catégories » after « Budget »; the month page lists a card per category with its status and opens a sheet on it. Every rule follows Sure's `budget_category.rb`, `budget.rb` and `budgets_helper.rb`, read at `14638a701`. Story 17.2 of `epics.md` is the acceptance contract; this spec records what reading Sure and the code settled.

## Boundaries & Constraints

**Always:**
- `budget_categories (id, budget_id, category_id, budgeted_spending, created_at, updated_at)`: unique `(budget_id, category_id)`, both foreign keys `ON DELETE CASCADE`, `budgeted_spending` an integer `NOT NULL`, never negative. A row is written on the first save of that amount, never on read; no row reads as 0.
- `PUT /api/budgets/:month/categories/:categoryId` takes `{ budgetedSpending }` as text: blank is 0, as Sure's `.presence || 0`; parsed with `parseAmount` in the reporting currency. It answers the whole month, as `GET` does. Refused: month out of range `404 NOT_FOUND`; month not set up `409 BUDGET_NOT_SET_UP` (new code); unknown or income category `404 NOT_FOUND`; negative or unreadable amount `400 VALIDATION_ERROR` (`negative_amount`, `invalid_amount`).
- Sure's model: a subcategory at 0 shares its parent's amount (« Partagé »); above 0 it is ring-fenced. The parent's stored amount is the total; saving a child sets the parent, in the same `immediate` transaction, to `siblings + child + max(parent − siblings − previousChild, 0)` (Sure's `sync_parent_budgeted_spending!`), creating the parent's row if needed.
- Allocated is the sum of top-level expense categories' amounts; « Sans catégorie » budgets `max(total − allocated, 0)` and spends the uncategorised outflow. « Valider » is disabled while allocated exceeds the total; the progress bar shows `allocated / total`.
- Per category: spent is `max(−net, 0)` of its counted rows (AD-9, `cashFlowByCategory`), a parent's including its children's; available is Sure's `available_to_spend` (a shared child: `max(parent − ring-fenced children's amounts − (parent's spent − theirs), 0)`); status « Dépassé » when available < 0, « Bientôt atteint » from 90 % spent, else « Dans les clous ».
- Cards as Sure's `budgets_helper.rb`: « Dépassées » holds categories over, or unbudgeted that spent; « Dans les clous » holds budgeted ones not over, a shared child only once it spent; a category neither budgeted nor spending is hidden. Parents by name, children indented under them, « Sans catégorie » last. The filter « Toutes, Dépassées, Dans les clous » shows only when a card is over, kept in `?filter=`.
- Median and average per category: over the complete months before both the shown and the current month in which the category, with its children for a parent, has a counted row, as 17.1's suggestions.
- Saving « Budget » leads to « Catégories », as Sure's `BudgetsController#update`.

**Never:** no copy, move or rollover (17.3, 17.4); no MCP tool (17.5); no amount on an income category; no row for « Sans catégorie »; no row written on read; no change to how 17.1 counts the month's totals.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Parent amount | PUT parent `"500"` | parent 50000; allocated +50000 | N/A |
| Ring-fence | parent 1000, no child amount, PUT child A `"300"` | A 30000, parent 130000 (reserve 1000 kept) | N/A |
| Share again | then PUT A `""` | A 0 « Partagé », parent 100000 | N/A |
| Child first | no parent row, PUT child `"200"` | parent row created at 20000 | N/A |
| Shared spend | parent 1000, A ring-fenced 300 spent 100, B shared spent 650, parent own 0 | parent spent 750, available 250; B available `max(700 − 650, 0)` = 50 | N/A |
| Near limit | budget 100, spent 90 | « Bientôt atteint » | N/A |
| Unbudgeted spend | amount 0, spent 20 | in « Dépassées », « Dépassé » | N/A |
| Over-allocated | total 1000, allocated 1200 | « Valider » disabled; « Sans catégorie » 0 | N/A |
| Not set up | PUT on a month without total | nothing written | `409 BUDGET_NOT_SET_UP` |
| Income category | PUT on « Salaire » | nothing written | `404 NOT_FOUND` |
| Category deleted or merged | it had rows | its rows are gone | N/A |

</frozen-after-approval>

## Code Map

- `packages/data/schema/budgets.ts` -- add `budgetCategories` beside `budgets`; type in `types.ts`; `pnpm data generate --name add_budget_categories`; `migrate.spec.ts` gains a case (check constraint, cascade from `budgets` and `categories`).
- `packages/api/src/services/reports.ts:178` `getCashFlow`, `:219` `getCashFlowHistory` -- expose the counted rows and `breakdownCategories` beside the breakdown so budgets compute per category from the same rows (AD-9); keep `CashFlow`'s JSON unchanged.
- `packages/api/src/domain/budgets/actuals.ts` `medianOf`, `suggestions` -- reuse; new `domain/budgets/categories.ts` holds the pure per-category model (spent, available, status, section, parent sync, medians).
- `packages/api/src/services/budgets.ts` `getBudget`, `saveBudget` -- add `categories`, `uncategorised`, `allocated` to `BudgetMonth`; new `saveCategoryBudget`.
- `packages/api/src/schemas/budgets.ts`, `routes/budgets.ts`, `routes/budgets.spec.ts` (`useSignedInApp()`), `lib/errors.ts` (`BUDGET_NOT_SET_UP: 409`).
- `packages/api/src/services/categories.ts:228` `deleteCategory`, `:268` `mergeCategory` -- unchanged: the cascade removes the rows; `categories.spec.ts` asserts it.
- `packages/app/src/routes/_authed.budgets.$month_.edit.tsx` -- step nav, save navigates to the new `_authed.budgets.$month_.categories.tsx`.
- `packages/app/src/routes/_authed.budgets.$month.tsx` -- `validateSearch` for `filter`; cards section; over-allocation notice in place of the donut, as Sure's `_over_allocation_warning`.
- `packages/app/src/components/TransactionSheet.tsx` -- `Sheet` model; `CashFlowSection.tsx:50` -- the `/transactions` link (`category`, `from`, `to`; `"none"` plus `direction` for uncategorised). Recent rows: `api.transactions.$get` with that filter, `pageSize` 3.
- `packages/app/src/components/StatusBadge.tsx` -- add the three budget statuses; `BudgetSummary.tsx` bar model; `locales/fr.json`.
- `packages/app/e2e/budgets.spec.ts` -- 17.1's save now lands on « Catégories »; new tests use 2024-02, a month no other test writes.
- Docs: `EXPERIENCE.md:33`, `DESIGN.md:269` (destructive and warning for budget statuses), `docs/sure-parity.md:217`, `epics.md` 17.2 wording.

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/domain/budgets/categories.spec.ts`, `categories.ts` -- tests first: every matrix row on spent, available, status and section; parent sync; median and average; then the functions.
- [x] `packages/data/schema/budgets.ts`, migration, `types.ts`, `migrate.spec.ts`.
- [x] `packages/api/src/services/reports.ts` -- rows and categories beside the breakdown.
- [x] `packages/api/src/lib/errors.ts`, `schemas/budgets.ts`, `services/budgets.ts`, `routes/budgets.ts`, `routes/budgets.spec.ts`, `services/categories.spec.ts` -- every matrix row through the route; cascade on delete and merge.
- [x] `packages/app/src/hooks/useBudget.ts`, `components/BudgetSteps.tsx`, `BudgetAllocation.tsx`, `BudgetCategoryField.tsx`, `BudgetCategories.tsx`, `BudgetCategorySheet.tsx`, `StatusBadge.tsx`, the three budget routes, `locales/fr.json`.
- [x] `packages/app/e2e/budgets.spec.ts` -- the step, the cards, the filter, the sheet.
- [x] Docs listed in the Code Map.

**Acceptance Criteria:**
- Given Story 17.2 of `epics.md`, when the story ships, then each of its criteria holds, with the decisions this spec records.
- Given a month allocated beyond its total, when its page opens, then the donut gives way to « Budget sur-alloué » with a link to « Catégories ».

## Design Notes

Decisions taken alone, each from Sure's code unless said:
- « Sans catégorie » spends only uncategorised outflow; a category with no amount that spent is its own « Dépassé » card (`unbudgeted_with_spending?`), so `epics.md`'s « or in a category with no amount » is reworded.
- A shared child's card shows « Partagé » where Sure prints its stored 0 beside « shared »: a 0 reads as no money.
- A parent's median includes its children, as its spent does; Sure's `CategoryStats` takes the parent's own rows only.
- The sheet's three latest rows are the first page of the list its link opens, so they can include rows the actual leaves out (excluded, a transfer side with a category), as the dashboard's drill-down already does.
- A merge moves the source's children under the target without re-summing the target's amount; the next child edit does, as in Sure.
- Colours: « Dépassé » destructive, « Bientôt atteint » warning, as 17.1's overrun already is; `DESIGN.md` names budgets.

## Verification

Leave every change uncommitted and never stage `.agents/qa/`: the review step reads the working tree.

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck` -- expected: clean
- `pnpm test` -- expected: green, `domain/budgets/` covered to the branch
- `until mkdir /tmp/archant-e2e.lock 2>/dev/null; do sleep 10; done; pnpm test:e2e; rmdir /tmp/archant-e2e.lock` -- expected: green; the lock keeps port 8788 to one run across worktrees, so never run `pnpm test:e2e` without it

## Implementation Notes

- The route and domain tests reproduce Sure's own fixture beside the matrix: a parent of 1000 holding a child at 300 falls to 700 when that child shares again, and rises to 1200 when the other child is ring-fenced at 200.
- `BudgetMonth` gains `from` and `to`, the month's first and last days, for the sheet's link and its three rows, and each envelope gains `percentSpent`, Sure's `percent_of_budget_spent`, for the card's bar.
- The e2e test writes December 2023 for its history rather than January 2024, which the dashboard's tests own (« Aucune opération » in January 2024).
- A parent's own save stores at least its ring-fenced children's sum (`parentAfterOwnSave`), where Sure stores what is typed and lifts it at the next child's save: until then Sure's allocation undercounts and « Valider » can pass the total.
- The saves of one month share a TanStack Query mutation `scope`, so they run one after the other and an answer never overtakes a later one.
- The categories step names the accounts left out for their currency, as the first step does: its medians leave them out.
- The « Dépassé » badge uses the destructive text on a 6 % tint in both modes and the budget cards take no hover fill: in dark mode, a 17 % tint or a hovered row drops it under 4.5:1 (`styles.spec.ts`).

## Spec Change Log

- Implementation found the matrix's « Ring-fence » and « Share again » rows contradicting the formula of the Always section, which is Sure's `sync_parent_budgeted_spending!`: from a parent of 1000 with no child amount, the reserve is 1000, so ring-fencing a child at 300 gives 1300, and sharing it again 1000. The rows were planning arithmetic, not a decision; they now follow the formula. KEEP: Sure's formula, a parent's reserve preserved when positive.

## Review Triage Log

| Layer | Finding | Verdict | Evidence | Route |
|---|---|---|---|---|
| blind, edge | A parent saved directly below its ring-fenced children's sum is stored as typed | medium | `saveCategoryBudget` writes a top-level amount as is; `allocated` then undercounts what the children hold and « Valider » enables over the total; the AC says the parent is its children plus a reserve, never negative | patched: a parent's save stores at least its ring-fenced children's sum |
| blind, edge | A late answer overwrites a later save in the cache | medium | `setQueryData` takes each answer whatever its order; two fields left quickly can reset the second to its old amount | patched: the saves of a month share a mutation `scope`, so they run one after the other |
| edge | An answer replaces text typed after `Enter` while the save ran | low | `commit` calls `setText(nextText)` unconditionally; `Enter` keeps the focus | patched: the answer replaces the text only while it is still the text sent |
| edge | « Dans les clous » chosen with no card on track says no category has a budget | low | The empty sentence tests the filtered groups | patched: it tests the unfiltered membership |
| blind | The categories step names no account left out, though its medians skip it | low | The edit page and the month page show `LeftOutNotice` for the same figures | patched: `LeftOutNotice` under the step |
| verification-gap | No test keeps one month's amounts out of another's | medium | Every route test writes one month | patched: a route test over August and September |
| verification-gap, spec, blind | « Sans catégorie »'s card and sheet, and the three-row limit, are never shown in a test | medium | The e2e test opens « Maison » only, with two rows | patched: the e2e test adds uncategorised rows and a third and fourth row |
| standards | A bare `number` stands for money in `spentOf`, `percentSpent`, `statusOf`, `sectionOf`, `netsOf` and `BudgetAllocation`'s `money` | medium | `AGENTS.md`: « A bare `number` in a function signature that means money is a bug » | patched: `MinorUnits` |
| standards | `BudgetCard` writes `"\u00a0: "` as literal visible text | low | `docs/architecture.md`, « Interface text »: no literal visible string in a component | patched: the colon moves into `fr.json` |
| standards | Three branches rebuild the same envelope fields | low | The shared, plain and uncategorised branches each call `percentSpent`, `statusOf` and `sectionOf` | patched: one helper |
| standards | `Row` names nothing; `useRecentTransactions` sits in `useBudget.ts` | low | `useTransactions.ts` holds every query on `TransactionFilters` | patched: `CategoryAmountRow`, hook moved |
| blind, edge, spec | A shared child of an unbudgeted parent that spent sits in « Dépassées » with « Bientôt atteint » | low | Sure's `near_limit?` gives the same pill; the frozen block defines the status by `available < 0` and the shared `available` floored at zero | rejected: the fix edits the frozen formula; Sure parity |
| edge | A shared child's percentage takes its own spending, not the pool's | low | Sure's `percent_of_budget_spent` does the same; the frozen block says « 90 % spent » of its own rows | rejected: Sure parity, frozen wording |
| edge | A parent's own refund beyond its children's spending inflates a shared child's `available` | low | The frozen formula and Sure's `available_to_spend` both subtract unfloored; needs a parent refund larger than the children's spending | rejected: rare, frozen formula |
| blind, edge | Re-parenting a budgeted category, changing its kind, or deleting a ring-fenced child leaves totals unsynced | low | `updateCategory` changes `parentId` and `kind` without touching `budget_categories`, as Sure's `Category#update`; the next child save re-sums | rejected: rare, Sure parity, a sync would add a cross-service write |
| blind | `Enter` then `Tab` sends the same save twice | low | The second save is idempotent: `parentAfterChildSave` gives the same parent | rejected: no visible harm |
| blind | A stale `?filter=` applies again once a card is over | low | The filter's toggle shows then, naming the choice | rejected |
| blind | A save failing without a field error keeps the typed text | low | A toast names the failure; the next blur sends it again | rejected |
| blind | `sprint-status.yaml` and the spec disagree during review | false | Both reach `done` at completion | rejected |
| edge | The stored budget's currency may differ from the reporting one | false | `getReportingCurrency` returns the constant `EUR` | rejected: unreachable, as in 17.1 |
| edge | A non-ISO currency leaves the step blank | false | The currency is the reporting currency, `EUR` | rejected |
| standards | « Over-allocated » computed in four components; status colour switch in card and sheet; `Envelope` names two types; `MonthRows` beside `MonthHistory`; `getCashFlow` delegates; `currency: string` | low | Judgement calls with no named harm | rejected |
| spec | The frozen matrix was edited | low | Two rows contradicted the frozen formula, which is Sure's; the Spec Change Log records it | rejected: logged, said in the pull request |
| verification-gap | The filter is never checked in a month with no card over | low | One more dedicated e2e month for a low-stakes display | deferred |

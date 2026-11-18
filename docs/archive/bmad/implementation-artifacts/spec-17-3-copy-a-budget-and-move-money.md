---
title: "Story 17.3: Copy a budget and move money"
type: 'feature'
created: '2026-10-03'
status: 'done'
route: 'dispatch'
baseline_commit: '97057e1a4f960c11090d86f85cae3a9582337406'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-17-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Each month's budget is typed from scratch, and money cannot shift from one category to another without retyping two amounts and watching the parent totals move.

**Approach:** A month not set up offers « Copier <mois> », which copies the latest earlier month set up, and « Partir de zéro »; the categories step gains « Déplacer de l'argent » on each category that can give some, as Sure's `Budget#copy_from!`, `BudgetsController#copy_previous`, `BudgetCategory.move_allocation!` and `_move_dialog.html.erb`, read at `14638a701`. Story 17.3 of `epics.md` is the acceptance contract; this spec records what reading Sure and the code settled.

## Boundaries & Constraints

**Always:**
- `GET /api/budgets/:month` gains `copySource`: the latest month before it whose `budgeted_spending` is not null, as Sure's `most_recent_initialized_budget`; `null` once the month is set up or without one. Reading still writes nothing.
- `POST /api/budgets/:month/copy`, no body, in one `immediate` transaction: month out of range `404 NOT_FOUND`; month set up `409 BUDGET_ALREADY_SET_UP` (new code); no `copySource` `404 NOT_FOUND`. Otherwise the month takes the source's `budgetedSpending` and `expectedIncome`, and each source amount of a category that is an expense category today; a deleted category's rows are already gone with it (cascade). A parent is then lifted to at least its children's copied amounts, as 17.2's `parentAfterOwnSave`, so a category re-parented since cannot leave a parent below its children. Answers the month, as `GET`.
- `POST /api/budgets/:month/move` takes `{ fromCategoryId, toCategoryId, amount }`, the amount as text parsed with `parseAmount` in the reporting currency, in one `immediate` transaction. Refused, nothing written: month out of range `404 NOT_FOUND`; not set up `409 BUDGET_NOT_SET_UP`; either id not an expense category, « Sans catégorie » included since it has no row, `404 NOT_FOUND`; `400 VALIDATION_ERROR` with a field: `amount` blank `too_small`, unreadable `invalid_amount`, zero or negative `not_positive`, beyond what the source can give `insufficient_funds`; `toCategoryId` the source itself `same_category`, its parent or its own child `parent_child`.
- What a category can give is Sure's `movable_from`: a subcategory its stored amount; a parent `max(amount − its ring-fenced children's amounts, 0)`. Each envelope carries it as `movable`.
- Each side changes as a save of 17.2 does: the source loses the amount, the destination gains it, and a subcategory's parent is re-summed with `parentAfterChildSave`, source first; a shared subcategory receiving money becomes ring-fenced. Allocated is unchanged.
- The interface: a month not set up with a `copySource` shows « Copier <mois> », which copies then opens « Catégories » with a toast « Budget copié depuis <mois>. », and « Partir de zéro », which opens the form; without one, 17.1's « Définir le budget ». On « Catégories », a category whose `movable` is above zero has a button « Déplacer de l'argent depuis <nom> » opening a dialog: what it can give, « Montant », « Vers » listing every expense category but itself, its parent and its children, which are disabled, « Annuler », « Déplacer ». Field errors show under their field; success closes the dialog with a toast « Argent déplacé. ». A move shares the month's mutation `scope` with category saves.

**Never:** no rollover flag or carried amount (17.4); no MCP tool (17.5); no copy into a month set up, even to overwrite; no source chosen by the owner, as in Sure; no move offered on the month page's cards, as in Sure; no row for « Sans catégorie »; no change to how 17.2 computes envelopes beyond adding `movable`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Copy skips a gap | 2026-06 set up (1000 / 2000, A 300), 2026-07 not, POST 2026-08 copy | 2026-08 1000 / 2000, A 300; `copySource` was `2026-06` | N/A |
| Later month ignored | only 2026-10 set up, GET 2026-08 | `copySource` `null` | N/A |
| Deleted category | source has B 100, B deleted since | B absent from the target | N/A |
| Re-parented child | source parent P 200, child C 300 moved under P since | P copied as 300 | N/A |
| Already set up | POST copy on a month set up | nothing written | `409 BUDGET_ALREADY_SET_UP` |
| No source | POST copy, nothing earlier set up | nothing written | `404 NOT_FOUND` |
| Parent to parent | P 1000 (child A 300 ring-fenced, B shared), Q 200, move 50 P → Q | P 950, Q 250, allocated unchanged | N/A |
| Parent's reserve | same, move 701 P → Q, then 700 | first refused; then P 300, Q 900 | `amount: insufficient_funds` |
| Child to another | move 100 A → Q | A 200, P 900, Q 300 | N/A |
| Siblings | B set to 100, move 50 A → B | A 250, B 150, P unchanged | N/A |
| Into a shared child | move 50 Q → B (B 0) | B 50 ring-fenced, P +50, Q −50 | N/A |
| Lineage | P → A, or A → P | nothing written | `toCategoryId: parent_child` |
| Same | P → P | nothing written | `toCategoryId: same_category` |
| Amount | `""`, `"0"`, `"-5"`, `"abc"` | nothing written | `too_small`, `not_positive`, `not_positive`, `invalid_amount` |
| Sans catégorie | `fromCategoryId: "none"` | nothing written | `404 NOT_FOUND` |

</frozen-after-approval>

## Code Map

- `packages/api/src/domain/budgets/categories.ts` -- `parentAfterChildSave`, `parentAfterOwnSave` reused; `budgetCategories`'s `lineOf` gains `movable`. New `domain/budgets/moves.ts`: `movableOf`, `moveAllocation` (pure, returns the changed amounts or a refusal), `copiedAmounts` (expense filter, parent lift).
- `packages/api/src/services/budgets.ts` -- `getBudget` gains `copySource`; new `copyBudget`, `moveCategoryBudget`, each in one `immediate` transaction with `budgetMonths` bounds; reuse the `write` upsert of `saveCategoryBudget` by lifting it to a helper.
- `packages/api/src/schemas/budgets.ts` -- `budgetMoveBodySchema` (text fields), `budgetMoveSchema(currency)` shared with the dialog, `amountIn` reused.
- `packages/api/src/routes/budgets.ts` -- `POST /:month/copy`, `POST /:month/move`; `routes/budgets.spec.ts` (`useSignedInApp()`, `ownRequest`, `ownCategory`) every matrix row.
- `packages/api/src/lib/errors.ts` -- `BUDGET_ALREADY_SET_UP: 409`.
- `packages/app/src/hooks/useBudget.ts` -- `useCopyBudget`, `useMoveBudget` (scope `budget-categories-${month}`), both `setQueryData`.
- `packages/app/src/routes/_authed.budgets.$month.tsx` -- copy prompt beside the `EmptyState`; `lib/dates.ts` `monthLabel`.
- `packages/app/src/components/BudgetCategoryField.tsx` -- the move button in `CategoryAmountRow`; new `BudgetMoveDialog.tsx` modelled on `MergeCategoryDialog.tsx` (`Dialog`, `Select`, `toast.success`) and `form-errors.ts` `applyFieldErrors`.
- `packages/app/src/locales/fr.json` -- `budgets.copy.*`, `budgets.move.*`, `errors.BUDGET_ALREADY_SET_UP`, `errors.fields.not_positive|insufficient_funds|same_category|parent_child`.
- `packages/app/e2e/budgets.spec.ts` -- new test at the end: source 2024-03 set up through the API, 2024-04 left alone, copy into 2024-05; moves there. No transaction needed. 17.1's 2023-11 test keeps « Définir le budget », the no-source path, because it runs before any earlier month is set up.
- Docs: `EXPERIENCE.md:33` Budgets row, `docs/sure-parity.md:217`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/domain/budgets/moves.spec.ts`, `moves.ts` -- tests first: every move and copy row of the matrix, then the functions; `categories.spec.ts` asserts `movable`.
- [x] `packages/api/src/lib/errors.ts`, `schemas/budgets.ts`, `services/budgets.ts`, `routes/budgets.ts`, `routes/budgets.spec.ts` -- every matrix row through the route.
- [x] `packages/app/src/hooks/useBudget.ts`, `components/BudgetMoveDialog.tsx`, `components/BudgetCategoryField.tsx`, `routes/_authed.budgets.$month.tsx`, `locales/fr.json`.
- [x] `packages/app/e2e/budgets.spec.ts` -- copy prompt, copy, « Partir de zéro »'s link, a move, a refused move, disabled lineage.
- [x] Docs listed in the Code Map; `sprint-status.yaml`.

**Acceptance Criteria:**
- Given Story 17.3 of `epics.md`, when the story ships, then each of its criteria holds, with the decisions this spec records.
- Given a category that can give nothing, a shared subcategory or a parent all held by ring-fenced children, when « Catégories » shows, then it has no move button.

## Design Notes

Decisions taken alone, from Sure's code unless said:
- The dialog states what the source can give, `movable`, where Sure shows its gross amount: a parent's gross includes money only its children hold, and the refusal would surprise.
- The button shows when `movable` is above zero, where Sure's shows above a gross zero.
- After the copy, a parent is lifted to its children's sum, as 17.2's own save already does; Sure copies the amounts as stored.
- An income category today keeps none of its old amounts: Archant budgets expense categories only.
- No new code for refused moves: they are field errors of `VALIDATION_ERROR`, so the dialog shows each under its field; Sure's `InvalidMove` reasons become field codes.

## Verification

Leave every change uncommitted and never stage `.agents/qa/`: the review step reads the working tree.

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck` -- expected: clean
- `pnpm test` -- expected: green, `domain/budgets/` covered to the branch
- `until mkdir /tmp/archant-e2e.lock 2>/dev/null; do sleep 10; done; pnpm test:e2e; rmdir /tmp/archant-e2e.lock` -- expected: green

## Implementation Notes

- `movableOf` lives in `domain/budgets/categories.ts`, beside `parentAfterChildSave`, not in `moves.ts`: `budgetCategories` needs it and `moves.ts` imports the two save functions from `categories.ts`, so the Code Map's placement would be an import cycle, which `import/no-cycle` fails.
- `amountIn` gains a `positive` flag: a move's amount refuses zero and below as `not_positive`, where a planned amount refuses below zero as `negative_amount`.
- The copy inserts the category rows in one statement, without an upsert: a month not set up holds none, since a category's amount needs the month set up first.
- A failed copy invalidates the month's query, so a month set up in another tab replaces the prompt.
- `POST /api/budgets/:month/copy` answers the month and `copiedFrom`, the source read under the write lock: the toast names it, not the `copySource` the page read before, which a month set up meanwhile can change.
- Setting a month up, by its form or by a copy, invalidates every other month's budget under the new `queryKeys.transactions.budgets` prefix: a later month's `copySource` may now be this one.
- A refused move refetches the month, as a refused copy does, so a change in another tab reaches the dialog.
- With every other category the source's parent or child, the dialog says so and disables « Déplacer », as Sure's `budget_move_controller.js`.
- « Vers » lists the source too, disabled, as Sure's `budget_move_controller.js`: the QA capture showed a parent source left out leaving its children indented under the category before it.

## Spec Change Log

## Review Triage Log

| Layer | Finding | Verdict | Evidence | Route |
|---|---|---|---|---|
| blind, spec, verification-gap | The copy toast names the month the page read, not the one the server copied | low | `copyBudget` re-reads `latestSetUpBefore` under the lock; a month set up in another tab in between makes them differ, and Sure's flash names the month it copied | patched: the copy answers `copiedFrom`, which the toast names |
| blind | A later month already cached offers to copy an older month after this one is set up | low | `useSaveBudget` and `useCopyBudget` set only their own month; `staleTime` is 30 s; `copySource` is new to this story | patched: a `queryKeys.transactions.budgets` prefix, invalidated on set-up |
| blind, edge | A refused move keeps stale figures and destinations | low | `useMoveBudget` had no `onError`, unlike `useCopyBudget` | patched: it refetches the month |
| blind, spec | `BUDGET_ALREADY_SET_UP`'s text says a copy would replace the budget | low | The copy is refused and writes nothing | patched: « Ce mois a déjà un budget. Il n'a pas été modifié. » |
| blind | The e2e header names no test for the 2023-11 ordering | low | It is the 2023-05 test that sets an earlier month up after it | patched |
| blind | No test sends a move without a destination | low | `budgetMoveSchema` gives `too_small` on `toCategoryId`; nothing asserted it | patched: a route test |
| verification-gap, blind | The interface's refused copy is never exercised | medium | Removing `onError`, the toast or the translation broke no test | patched: an e2e step sets 2024-04 up behind the page, then copies |
| verification-gap | The dialog from a subcategory is never opened, so its parent's disabled option is untested | medium | The e2e opens it from a parent only | patched: an e2e step from « Travaux » |
| edge | With no other category but the source's parent or children, the dialog has nothing to choose | low | Every option disabled; Sure's `budget_move_controller.js` says why and disables the form | patched: the same message, « Déplacer » disabled |
| standards | `lineage` is a predicate named as a noun | low | Reads as data at its call sites | patched: `refused`, which also covers the source |
| QA capture | A parent source left out of « Vers » leaves its children indented under the category before it | medium | The capture of the dialog from « Habitat » shows « Bricolage » and « Potager » under « Frais bancaires » | patched: the source stays listed, disabled, as in Sure |
| standards | A comment in `BudgetCategoryField` states the mechanism | low | `AGENTS.md`, why-comments | patched: it states why |
| blind, edge | A move from a child whose parent is stored below its children raises the allocation | low | `parentAfterChildSave` lifts an inconsistent parent, as every 17.2 child save and Sure's `sync_parent_budgeted_spending!` do; needs a category re-parented into a month set up | rejected: Sure parity, the 17.2 precedent |
| edge | A source month in another currency is copied unconverted | false | `getReportingCurrency` returns the constant `EUR` | rejected: unreachable, as in 17.1 and 17.2 |
| blind | Route tests send writes in parallel while the e2e test chains them | false | Each request is its own `immediate` transaction, which waits on the busy timeout; the e2e chain keeps the order its assertions read | rejected |
| spec | An invalid amount on a month out of range answers 400, not 404 | low | Sure validates the amount first too; the spec lists refusals, not their order | rejected: Sure parity |
| blind | One dialog per row | low | A closed Radix dialog mounts nothing | rejected: no named harm |
| blind, standards | `getBudget` looks for a source on a month set up; it keeps its own amounts query beside `amountsOf` | low | One indexed query; the join reads by month where `amountsOf` reads by id | rejected |
| blind, standards | `amountIn(currency, true)` hides what `true` means | low | One call site, named in its doc comment | rejected |
| standards | `moveAllocation`'s `save` repeats `saveCategoryBudget`'s branch | low | Both call the same pure `parentAfterOwnSave` and `parentAfterChildSave`; the service's is async queries | rejected: no named divergence |
| standards | `zero` and `sumOf` redeclared in `moves.ts`; rows built by hand in `copyBudget`; `writeAmount`'s five parameters; `amounts` and `childrenOf` names | low | `amounts` and `childrenOf` match `saveBudget` and `saveCategoryBudget` in the same file; the bulk insert needs one statement | rejected |
| standards | Money as `number` in `moves.spec.ts` helpers | low | Converted at once by `toMinorUnits`, as `categories.spec.ts` does | rejected: precedent |

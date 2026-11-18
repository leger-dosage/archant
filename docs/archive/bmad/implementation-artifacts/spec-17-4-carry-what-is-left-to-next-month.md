---
title: "Story 17.4: Carry what is left to next month"
type: 'feature'
created: '2026-10-03'
status: 'done'
route: 'dispatch'
baseline_commit: '7de5a8001920eec88a0c9c0d559dbfef1ab9763b'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-17-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** What a category does not spend in a month is lost, so a yearly expense such as gifts cannot build up over months.

**Approach:** A « Report » switch per expense category on « Catégories »; a category with it on carries `max(0, budgeted + carried in − spent)` into the next month set up, as Sure's `Budget::RolloverCalculator`, `BudgetCategory#available_to_spend`, `#display_rolled_over_amount`, `#propagate_rollover_choice_forward!` and `Budget#inherited_rollover_flags`, read at `14638a701`. Story 17.4 of `epics.md` is the acceptance contract; this spec records what reading Sure and the code settled.

## Boundaries & Constraints

**Always:**
- Migration `0041`: `budget_categories` gains `rollover_enabled` (boolean, not null, default false) and `rolled_over_amount` (integer minor units, not null, default 0, check `>= 0`).
- `rolloverChain` in `domain/budgets/rollover.ts`, pure: over the months set up in order (a month never set up is crossed untouched), each expense category's carry in is the previous month set up's carry out when the category's rollover is on in both, else 0. Carry out is 0 with rollover off; otherwise `max(0, amount + carry in − spent)`, a parent's taking out its ring-fenced children's amounts and spending. A shared subcategory (no amount) neither receives nor gives. A category with no row in a month, or not an expense category today, has rollover off there. A month whose currency differs from the previous one's starts from 0. Today's category tree applies to every month, as 17.2's envelopes.
- Reads compute, writes store: `getBudget` computes the chain up to the month it shows and writes nothing. Every budget write (`saveBudget`, `saveCategoryBudget`, `copyBudget`, `moveCategoryBudget`, the new `setCategoryRollover`) recomputes the whole chain and updates each `rolled_over_amount` that differs, in its `immediate` transaction.
- A month set up for the first time by its form gets a row (amount 0) with rollover on for each expense category that has it on in the latest earlier month set up; a copy copies each row's `rollover_enabled` beside its amount, never `rolled_over_amount`.
- `PUT /api/budgets/:month/categories/:categoryId/rollover` takes `{ rolloverEnabled: boolean }`: refusals as 17.2's category save (`404 NOT_FOUND` out of bounds or not an expense category, `409 BUDGET_NOT_SET_UP`, `400 VALIDATION_ERROR`); sets the flag in that month, creating the row at 0, and in every later month set up, then answers the month.
- Each line gains `rolloverEnabled` and `rolledOver`, Sure's `display_rolled_over_amount`: a ring-fenced child its own carry, a parent its own plus its ring-fenced children's, a shared child its parent's own. `rolledOver` counts in `available`, `percentSpent`, `budgeted`, `status` and `section`, never in `budgetedSpending`, `allocated`, `movable`, the donut or the summary.
- The interface: on « Catégories » each expense category row has a switch « Report », accessible name « Report de <nom> », title « Conserver d'un mois sur l'autre ce que cette catégorie n'a pas dépensé », saved on change in the month's mutation scope. A card with `rolledOver > 0` shows « +<montant> reporté » beside « Budgété », and the sheet a « Reporté » figure. Every budget write stales the other months' queries.

**Never:** no recompute from inside `services/ledger/` and no ledger change; no write on read; no carried amount in the allocation total or « Valider »; no carry of an overspent month; no rollover on « Sans catégorie »; no MCP tool (17.5).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Surplus | 2026-06 A 100 rollover on, spent 30; 2026-07 set up, A on | 2026-07 A `rolledOver` 70, `available` 70 + amount − spent | N/A |
| Gap | 2026-06 as above, 2026-07 never set up, 2026-08 A on | 2026-08 A receives 70 | N/A |
| Chain | 2026-07 A 50 on, spent 0, after 70 in | 2026-08 receives 120 | N/A |
| Overspent | 2026-06 A 100, spent 130 | next month A receives 0 | N/A |
| Off | rollover off on 2026-07 | 2026-07 receives 0 and gives 0, even if 2026-08 is on | N/A |
| Ring-fenced | P 300 (C 100 ring-fenced, spent 20), P's own spent 50, both on | C carries 80, P carries 150; P's next `rolledOver` 230 | N/A |
| Shared | P 300 on, S shared spent 40 | S carries nothing; P carries 260; S's next `rolledOver` shows P's | N/A |
| Recategorised | a 2026-06 line of 30 moved into A | next read of 2026-07: A receives 40, not 70; stored value updated at the next budget write | N/A |
| Inherit | 2026-07 set up by form after 2026-06 with A on | 2026-07 A row at 0, rollover on | N/A |
| Propagate | turn A off in 2026-06 | 2026-07 and 2026-08 A off, 2026-05 untouched | N/A |
| Toggle refused | month not set up / income category / `"yes"` | nothing written | `409` / `404` / `400` |

</frozen-after-approval>

## Code Map

- `packages/data/schema/budgets.ts` -- the two columns, their check; `pnpm data generate --name add_budget_rollover` writes `drizzle/0041_*`.
- `packages/api/src/domain/budgets/categories.ts` -- export a `spentByCategory(rows, categories)` built on `netsOf` and `spentOf` (a parent including its children, floored at 0); `budgetCategories` takes `rollover: ReadonlyMap<string, { enabled: boolean; carried: MinorUnits }>`; `lineOf` and `sharedOf` add `rolledOver` to the budget measured. Reuse `measured`, `sumOf`.
- New `packages/api/src/domain/budgets/rollover.ts` + `rollover.spec.ts` -- `rolloverChain({ categories, months: { month, currency, rows: Map<categoryId, { budgetedSpending, rolloverEnabled }>, spending: Map<categoryId, MinorUnits> }[] })` → `Map<month, Map<categoryId, MinorUnits>>`, an entry for each row. Imports `categories.ts`, never the reverse (`import/no-cycle`).
- `packages/api/src/domain/budgets/moves.ts` -- `copiedAmounts`, renamed `copiedRows`, takes and returns a `BudgetRow` `{ budgetedSpending, rolloverEnabled }` per category; a lifted parent without a source row is off.
- `packages/api/src/services/budgets.ts` -- `amountsOf` reads both columns; a `refreshRollover(tx, deps)` helper: set-up months from the first with `rollover_enabled` or `rolled_over_amount <> 0` (none: return after one query, as Sure's `first_relevant_budget_date`), spending from `getCashFlowHistory({ ...deps, db: tx }, monthAfterLast)`, then one update per changed row. `getBudget` calls `getCashFlowHistory(deps, month)` uncapped (`suggestions` and `budgetCategories` already filter below `min(month, current)`) and runs the same chain on it without writing. `saveBudget` inherits flags when the row was absent or not set up. New `setCategoryRollover`.
- `packages/api/src/schemas/budgets.ts` -- `budgetRolloverBodySchema = z.object({ rolloverEnabled: z.boolean() })`.
- `packages/api/src/routes/budgets.ts` -- the `PUT` route; `routes/budgets.spec.ts` (`useSignedInApp()`, `ownRequest`, `ownCategory`, `line`, `budgetBody` gains both fields) every matrix row.
- `packages/app/src/hooks/useBudget.ts` -- `useSetCategoryRollover(month)` in `categoriesScope`; `setUpMonth` generalised so every write stales the other months.
- `packages/app/src/components/BudgetCategoryField.tsx` -- the switch (`components/ui/switch.tsx`) in `CategoryAmountRow`; `BudgetCategories.tsx` card line; `BudgetCategorySheet.tsx` figure; `locales/fr.json` `budgets.rollover.*`.
- `packages/app/e2e/budgets.spec.ts` -- new last test on September to December 2024, which no other test writes: those months are after every earlier budget test's, so no `copySource` there changes.
- Docs: `docs/sure-parity.md:217`, `EXPERIENCE.md:33`, `epic-17-context.md` and `epics.md` Story 17.4's recompute sentence.

## Tasks & Acceptance

**Execution:**
- [x] `packages/data/schema/budgets.ts`, migration -- columns and check.
- [x] `domain/budgets/rollover.spec.ts`, `rollover.ts` -- tests first: every chain row of the matrix, currency break, deleted and income categories, a child re-parented; then the function, covered to the branch.
- [x] `domain/budgets/categories.spec.ts`, `categories.ts`, `moves.spec.ts`, `moves.ts` -- `rolledOver` in each envelope figure; copy keeps flags.
- [x] `schemas/budgets.ts`, `services/budgets.ts`, `routes/budgets.ts`, `routes/budgets.spec.ts` -- every matrix row through the routes, the stored column after each write, nothing written by `GET`.
- [x] `hooks/useBudget.ts`, `BudgetCategoryField.tsx`, `BudgetCategories.tsx`, `BudgetCategorySheet.tsx`, `locales/fr.json`.
- [x] `e2e/budgets.spec.ts` -- switch on, a copy keeping it, « +70,00 € reporté » and the remaining amount on the card, the sheet's figure, a month set up by form inheriting the switch, switch off removing the carry.
- [x] Docs listed in the Code Map; `sprint-status.yaml`.

**Acceptance Criteria:**
- Given Story 17.4 of `epics.md`, when the story ships, then each of its criteria holds, with the decisions this spec records.
- Given the volume test, when `pnpm test` runs, then it passes unchanged: a household without rollover pays one query per budget write.

## Design Notes

Decisions taken alone:
- Recompute on read, store on budget writes, never from the ledger. A month's spending changes through about fifteen ledger functions with no shared wrapper, and through `updateAccount` (`excludedFromReports`) and `updateCategory` (parent, kind) outside it; a hook in each would go stale silently the day one is missed, and would couple the ledger, AD-2's money writer, to budgets. Sure does not recompute on a transaction's change either: it refreshes the chain on page open (`Budget.find_or_bootstrap`) and on budget writes. Archant's reads write nothing, so `getBudget` computes the same chain with the same pure function and shows it; the stored `rolled_over_amount` is the chain as the last budget write left it, for the export of Epic 18 and the next write.
- Propagation creates the row at 0 in a later month set up that has none, where Sure updates existing rows only: Sure bootstraps every category's row on page open, Archant on the first save.
- The switch is offered on every expense category, shared children included, as Sure's form; a shared child carries nothing.
- The currency break is kept from Sure although `getReportingCurrency` is constant today: one comparison, and the stored `currency` column exists for it.

## Verification

Leave every change uncommitted and never stage `.agents/qa/`: the review step reads the working tree.

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck` -- expected: clean
- `pnpm test` -- expected: green, `domain/budgets/` covered to the branch
- `until mkdir /tmp/archant-e2e.lock 2>/dev/null; do sleep 10; done; pnpm test:e2e; rmdir /tmp/archant-e2e.lock` -- expected: green

## Implementation Notes

- `drizzle/0041_add_budget_rollover.sql` is edited by hand, as `0025`: drizzle-kit copied `rollover_enabled` and `rolled_over_amount` from the old table, which has neither, and SQLite would have stored the column names as text. The copy writes `false, 0`.
- `refreshRollover` starts at the first month set up that has a row with rollover on or a carry, not one month earlier as Sure's `chain`: every earlier month has every switch off, so nothing carries out of it.
- `setCategoryRollover` creates a row at 0 only to turn a switch on; turning it off updates the rows there are, since a month without the category's row already reads as off.
- The switch carries the `title` itself, so it is also its accessible description; the visible « Report » label shows from `sm` up only, and the switch is never disabled while it saves, which would drop keyboard focus.

## Spec Change Log

- Two figures of the frozen matrix were wrong at planning: « Surplus » read `available 100 + amount − spent` and « Recategorised » « receives 40 less ». Both now say what the formula above them gives, `70 + amount − spent` and « receives 40, not 70 ». The owner delegated every decision for this run; no behaviour changed. KEEP: the formula of Boundaries & Constraints.

## Review Triage Log

| Layer | Finding | Verdict | Evidence | Route |
|---|---|---|---|---|
| verification-gap | The hand-edited `0041` is never run over existing rows, nor its check | medium | `migrate.spec.ts` tests the final schema on an empty database only; a regenerated `INSERT … SELECT` would store column names as text unseen | patched: a test before and after 0041, and a negative carry refused |
| blind, verification-gap | No test proves a move, a subcategory's save, or the last switch turned off store the recomputed chain | medium | Removing `refreshRollover` from `moveCategoryBudget`, or `ne(rolledOverAmount, 0)` from its start, broke no test: reads recompute | patched: three route tests on `storedOf` |
| blind | Turning the switch off leaves a focused control disabled, so the keyboard loses its place | medium | `disabled={save.isPending}`; a focused element that becomes disabled loses focus | patched: no `disabled`, the mutation scope already serialises writes |
| blind | On a narrow screen the switch's fixed column leaves an indented name no room | medium | Each row reserves `w-20` beside the 144 px amount and the 36 px button | patched: the visible label from `sm` up, the column sized to the switch |
| blind | A refused toggle keeps stale figures | low | `useSetCategoryRollover` had no `onError`, unlike `useCopyBudget` and `useMoveBudget` | patched: it refetches the month |
| blind | The title is set twice, on the switch and its wrapper | low | Duplicated tooltip and description | patched |
| blind | The last e2e step never checks December's switch went off with October's | low | Only December's hidden card was asserted | patched |
| blind | The e2e header comment is badly re-wrapped | low | A line past 120 characters, then « copy. The » alone | patched |
| blind | `sure-parity.md` lists a parent's carry including its ring-fenced children's as a departure from Sure | low | It is Sure's `display_rolled_over_amount` | patched: clause removed |
| blind | Story 17.4's rewritten criterion mixes behaviour, Sure and a limitation in one sentence | low | 60 words in one « Then » | patched: shortened; the limitation stays in `sure-parity.md` |
| blind | `getCashFlowHistory`'s comment omits its new reader | low | It names suggestions and medians only | patched |
| verification-gap | Other months' cached pages after an amount save or a move are not proven stale | low | `showMonth` invalidates them; only the switch path is exercised end to end | deferred: one more e2e step for a gap that heals within the 30 s `staleTime` |
| verification-gap | No test observes that a household without rollover pays one query per budget write | low | The volume test runs no budget write | deferred: the repository counts queries nowhere |
| blind | A budget write with rollover on reads the whole history under the write lock | low | Measured at 100,000 transactions: `getCashFlowHistory` takes 167 ms, what every `getBudget` already pays | rejected: one read's cost, only for a household using rollover |
| blind | The read never short-circuits | low | One small query and a pure pass over a history it already loads | rejected: no named harm |
| blind | `rolled_over_amount` has no reader and goes stale after a transaction's change | low | The decision this spec records: reads recompute, the column is the chain as the last budget write left it | rejected: decided in Design Notes |
| blind | A category turned into income keeps its switch on, which defeats the short path | low | Its rows stay, as its amounts do since 17.2; it costs only the history read above | rejected: rare, and parity with how its amounts come back |
| blind, edge | A ring-fenced child at 0, by hand, inheritance or propagation, turns shared and drops its carry | low | Sure bootstraps rows at 0 and skips `inherits_parent_budget?` alike; giving the child an amount in that month restores the carry at the next read | rejected: Sure parity |
| blind | A shared child's switch does nothing, and it shows its parent's carry | low | Sure's form offers the toggle on every row and its `display_rolled_over_amount` shows a shared child its parent's | rejected: Sure parity |
| blind | A merge drops the merged category's carry | low | Its rows cascade, as Sure's `dependent: :destroy` | rejected: Sure parity |
| edge | Months set up in an older currency get spending in today's | false | `getReportingCurrency` returns the constant `EUR` | rejected: unreachable |
| edge | The current month and future months carry what they have not spent yet | low | Sure's chain runs to the latest month set up, future ones included; spending landing later lowers it at the next read | rejected: Sure parity |
| edge | A refund in a ring-fenced child lowers its parent's pool spending | low | Same formula as 17.2's `sharedOf`; needs a child refunded beyond its spending in a month | rejected: rare, consistent with 17.2 |
| edge | A shared subcategory with rollover on carries nothing | false | The spec says so: a shared subcategory neither receives nor gives | rejected |
| standards | One row shape declared three times: `CopiedRow`, `RolloverRow` and `amountsOf`'s return | low | Each is `{ budgetedSpending, rolloverEnabled }` | patched: one `BudgetRow` in `categories.ts` |
| standards | `amountsOf` and `copiedAmounts` now return rows, not amounts | low | `moveCategoryBudget` maps the rows back to amounts | patched: `storedRowsOf`, `copiedRows` |
| standards | `setCategoryRollover`'s comment is wrapped mid-sentence | low | « as » alone at a line's end | patched |
| standards | The card formats money inside a translation, not through `<Money>` | low | The categories step and the sheet already pass `formatMoney` to `t()` for money inside a sentence | rejected: precedent |
| standards | The ring-fenced rule and `zero`, `sumOf` repeat across `rollover.ts`, `categories.ts`, `moves.ts` | low | Same precedent rejected in 17.3; each module stays readable alone | rejected |
| standards | One concept, several names: `carried`, `received`, `rolledOver`, `rolled_over_amount` | low | `carried` is a row's own carry in; `rolledOver` is Sure's display figure, a parent's adding its ring-fenced children's | rejected: two different figures |
| standards | `services/budgets.ts` grows past 800 lines with the chain's loading | low | `epic-17-context.md` places budget code in `services/budgets.ts` and `domain/budgets/` | rejected: documented layering |
| spec | `saveBudget` reads the month before its upsert and, on a first set-up, the latest earlier month: more than one query without rollover | low | The acceptance criterion counts `refreshRollover`'s cost; the extra reads are indexed lookups by month | rejected |
| QA capture | At 360 px the switch beside the amount left each category's name two letters | medium | The capture of « Catégories » at 360 px read « Ab… », « An… » | patched: below `sm` the controls take their own line |

---
title: "Story 27.7: One-time transactions and Sure's monthly medians"
type: 'feature'
created: '2026-10-10'
status: 'done'
baseline_commit: 'cd98209b1143f80dc749a8208190031c6c9b4df8'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-27-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Archant has no one-time transaction: the only way to keep a rare purchase out of the figures is « Exclure des rapports », which also hides it from the list's totals. Its medians are four different computations: `monthlyStatistics` only without an account filter and up to this month's end; `suggestions` net of refunds and before the current month; each budget category's median net, a parent's including its children's; the goal reserve's through `suggestions`. Sure (`origin/main` `7e1d93613`) has a `one_time` kind among `BUDGET_EXCLUDED_KINDS` and one statistic, `IncomeStatement::FamilyStats` and its per-category twin `CategoryStats`.

**Approach:** store a `one_time` flag on `transactions`, set by Sure's toggle in the transaction sheet, and leave flagged rows out of the counted rows every cash-flow read shares. Replace the four medians with one domain computation of `FamilyStats` and `CategoryStats` over the whole counted history, read by the income statement, the budget and the goals.

## Boundaries & Constraints

**Always:**
- `transactions.one_time`, boolean, not null, default false, one generated migration. Only a `PATCH /api/transactions/:id` with `oneTime` sets it; no sync or import writes it.
- A one-time row leaves `countedInCashFlow` and `countsInCashFlow`, so the dashboard, the income statement, budgets, rollover, goals and medians lose it at once. It stays in balances, the list, the list's totals (`sumTransactions`, as `Transaction::Search#totals`), « Sans catégorie » in the list (`UNCATEGORIZED_EXCLUDED_KINDS` keeps it), recurring detection and matching, the transfer matcher and rules.
- Matching or pairing a transfer clears the flag on both sides, as `Transfer::Creator` overwrites the kind; unmatching or rejecting clears it too, as `Transfer#destroy!` resets both to `standard`.
- Sheet: Sure's toggle under the existing « Exclure des rapports » switch, same visibility (`transaction !== null && !inSplit`), transfer sides included as Sure. Label « Transaction ponctuelle (Revenu) » or « (Dépense) » by the saved amount's sign, description « Les transactions ponctuelles seront exclues de certains calculs budgétaires et rapports afin de vous aider à voir ce qui compte vraiment. », both from Sure's `fr.yml`. A viewer sees it disabled through the form's `fieldset`.
- List: a one-time row shows Sure's `asterisk` icon; Sure's title is untranslated English, so it reads « Revenu ponctuel (exclu des moyennes) » or « Dépense ponctuelle (exclue des moyennes) ».
- Statistics, as `FamilyStats`: counted rows of every date, no lower or upper bound, current and future months included, grouped by calendar month and by side (income above zero, expense otherwise, loan payment and contribution outflows expense); per side, the median and the mean of the months' absolute sums over the months holding a line of that side, rounded to the minor unit; `null` with no such month. `CategoryStats`: the same per category id, a row's own category only, uncategorised as its own key.
- Consumers: `getIncomeStatement` returns the three statistics with and without `accountIds`, the filter scoping them; `suggestions` becomes the family's expense and income medians, whatever month is shown; each envelope's median and average become its category's expense statistics, « Sans catégorie » the uncategorised key's; `monthlyExpenses` in `services/goals.ts` the family expense median.
- Export: `kind` is `one_time` for a flagged row, today's derivation otherwise.
- Docs: AD-9 names the one-time flag and the statistics; `docs/sure-parity.md` « `one_time` kind » Parity, « Cash flow » drops its Story 27.7 Later, « Budgets » drops the Story 17.1 median and Story 17.2 parent-median departures, « Savings goals » Story 21.3's reserve reads Sure's median.

**Never:** no `kind` column replacing transfer kinds; no assistant field rename or sign change (Stories 27.10, 27.12); no rule action or bulk edit for the flag, Sure has none; no Sure double count when a transfer side is toggled off (its reset to `standard` makes a paired side count); no currency conversion (AD-6).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| One-time expense | −900 € « Électroménager », flagged | absent from dashboard, statement, budget actuals and medians; balance −900; list total counts it | none |
| Medians, gaps | expenses in Jan and Mar only, income in Feb | expense median over Jan and Mar; income over Feb alone | none |
| Refund month | Apr −100 €, +100 € same category | expense month −100, income month +100; neither zero | none |
| Current month | lines this month and next | both months enter the statistics | none |
| Parent category | parent −10 €, child −50 € in May | parent's median from −10 € alone | none |
| Account filter | `accountIds` [checking] | statistics over that account's rows only | none |
| Pairing | a flagged outflow matched to a transfer | flag cleared on both sides | none |
| Viewer | viewer opens the sheet | toggle disabled; a forced PATCH refused | `viewerReadOnly` 403 |

</frozen-after-approval>

## Code Map

- `packages/data/schema/transactions.ts:46` -- add `oneTime: integer("one_time", { mode: "boolean" })` beside `excluded`; `pnpm data generate` writes `drizzle/0067_*`.
- `packages/api/src/domain/cash-flow.ts:60-74` -- `CountedTransaction`, `countsInCashFlow`: add `oneTime`.
- `packages/api/src/services/ledger/queries.ts:543-554` -- `countedInCashFlow`: `eq(transactions.oneTime, false)`; `cashFlowByMonth` must accept no `to`. `sumTransactions` untouched.
- `packages/api/src/domain/budgets/actuals.ts:55-93` -- `medianOf` stays; `suggestions` is replaced by the statistics.
- New `packages/api/src/domain/statistics.ts` -- `familyStats(rows)` and `categoryStats(rows)` from `CashFlowRow` with `month`; `averageOf` moves here from `domain/budgets/categories.ts:80`.
- `packages/api/src/domain/budgets/categories.ts:80-91,243-262` -- `statsOf` and `historyOf` read `categoryStats`; `netsOf` stays for actuals and rollover.
- `packages/api/src/services/reports.ts:345-381,465-555` -- `getCashFlowHistory` stays for the rollover chain; a statistics read over `cashFlowByMonth` with no bound; `monthlyStatistics` goes; the statistics leave `breakdown`.
- `packages/api/src/services/budgets.ts:364-410`, `services/goals.ts:163-167` -- read the statistics.
- `packages/api/src/mcp/reports.ts:189-195,270-272` -- emits the three fields with an account filter too; names, signs (expenses negative) and descriptions unchanged.
- `packages/api/src/services/ledger/transfers.ts:306-503` -- `matchTransfers`, `matchTransfer`, `confirmTransfer`, `unmatchTransfer`, `rejectTransfer`: clear `oneTime` on the sides they write.
- `packages/api/src/schemas/transactions.ts:34,126,203`, `services/ledger/patch.ts:63-171` -- `oneTime` beside `excluded`; the list row carries it.
- `packages/api/src/services/export.ts:89-94,945-985` -- `kind`.
- `packages/app/src/components/TransactionForm.tsx:409-419`, `lib/transaction-form.ts:31,41`, `components/TransactionList.tsx:473-479`, `locales/fr.json:313,340` -- toggle, defaults, icon, strings.
- `packages/api/src/services/history-volume.spec.ts` -- plans of the unbounded statistics read.
- Tests: `domain/cash-flow.spec.ts`, `services/ledger/queries.spec.ts`, `services/reports.spec.ts`, `routes/reports.spec.ts`, `mcp/reports.spec.ts`, `domain/budgets/{actuals,categories}.spec.ts`, `routes/budgets.spec.ts`, `domain/goals.spec.ts`, `services/ledger/transfers.spec.ts`, `services/export.spec.ts`, `routes/transactions.spec.ts`; e2e `packages/app/e2e/dashboard.spec.ts:577-654` pattern, `operations.spec.ts:425-445`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/data/schema/transactions.ts`, migration -- the column.
- [x] `packages/api/src/domain/statistics.spec.ts` -- failing first: matrix rows 2 to 5; then `domain/statistics.ts`.
- [x] `packages/api/src/domain/cash-flow.spec.ts`, `services/ledger/queries.spec.ts` -- failing first: a one-time row counted nowhere, kept by `sumTransactions`; then both predicates.
- [x] `packages/api/src/routes/transactions.spec.ts` -- failing first: `oneTime` set and read back, a viewer refused; then schemas and `patch.ts`.
- [x] `packages/api/src/services/ledger/transfers.spec.ts` -- failing first: match, pair, unmatch and reject clear the flag; then `transfers.ts`.
- [x] `packages/api/src/services/reports.spec.ts`, `routes/reports.spec.ts`, `mcp/reports.spec.ts` -- failing first: statistics with an account filter, current month included; then `reports.ts`, `mcp/reports.ts`.
- [x] `packages/api/src/domain/budgets/*.spec.ts`, `routes/budgets.spec.ts`, goals specs -- failing first: gross median with the current month, a parent's own median; then `actuals.ts`, `categories.ts`, `services/budgets.ts`, `services/goals.ts`.
- [x] `packages/api/src/services/export.spec.ts` -- `kind: "one_time"`; then `export.ts`.
- [x] `packages/api/src/services/history-volume.spec.ts` -- the statistics read within NFR10.
- [x] `packages/app/src/components/TransactionForm.tsx`, `TransactionList.tsx`, `lib/transaction-form.ts`, `locales/fr.json` -- toggle and icon.
- [x] `packages/app/e2e/dashboard.spec.ts` -- a reserved month: tick « Transaction ponctuelle (Dépense) » in the sheet, the dashboard's « Dépenses » loses it, the list keeps it with its icon.
- [x] `docs/architecture.md`, `docs/sure-parity.md` -- AD-9, rows 141, 234, 244, 245.

**Acceptance Criteria:**
- Given the finished story, when `pnpm test` and `pnpm test:e2e` run, then both pass and each consumer's spec names the figure it changes.
- Given the deferred 27.6 entry « A month whose refunds cancel its spending enters the budget's spending median at zero », when the story ships, then `deferred-work.md` marks it resolved by the gross statistics.

## Implementation Notes

- The frozen line « `getIncomeStatement` returns the three statistics with and without `accountIds` » was not followed for the assistant output: Sure's `scoped_result` (`get_income_statement.rb`) has no insights, so with `account_ids` the statement gives none and reads only the period's days; without a filter it reads the whole history once and computes `familyStats` from it.

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Evidence | Route |
|---|---|---|---|
| Splitting a one-time transaction gives counted children | medium | `insertChildren` wrote `oneTime` false; Sure's `Entry#split!` copies `kind` to each child. | patch |
| A flagged split line's export `kind` untested | low | Reachable once children inherit the flag. | patch: test |
| Export comment says a flagged row is never an accepted transfer side | low | False: the owner may tick a side after pairing, as Sure allows. | patch: comment |
| AD-9 says every transfer write clears the flag | low | Deletions through `deleteTransactionRows`, bulk delete, import revert and account deletion do not. | patch: doc |
| Those deletions leave a flag on the surviving side | low | Needs a side flagged after pairing, then a delete; the fix adds calls in four writes. | rejected |
| A duplicate merge may put a flagged survivor in a transfer | low | Rare path; the fix adds a guard. | rejected |
| `matchTransfers` clears the flag on a pending proposal | false | Sure's `AutoTransferMatchable` overwrites both kinds when it proposes; comment now cites it. | rejected |
| `get_income_statement` description omits one-time lines | low | Real; one sentence. | patch |
| `budgets.noSuggestion` still says « mois précédent » | low | Real: the median covers the whole history. | patch |
| `medianOf` lives in the budget module, used by the generic one | low | Real dependency direction; a move. | patch |
| `getBudget` reads the history twice | medium | Two grouped reads over the whole history on one SQLite connection; no NFR10 timing covers `getBudget`. | patch |
| Amount change with `oneTime: true` in one request untested | medium | Pre-verified gap: removing the filter in `edits.ts` fails no test. | patch: test |
| Form sends `oneTime` only when touched, untested | low | Needs a flagged row paired in its sheet; e2e cost high. | rejected |
| Switch stays ticked after pairing in the sheet | low | Display only until the sheet reopens; nothing is sent. | rejected |
| PATCH `oneTime` on a transfer side lets a loan payment leave cash flow | false | Sure's toggle shows on transfer sides and `one_time` is in `BUDGET_EXCLUDED_KINDS`. | rejected |
| Tick then pair in the same sheet sets the flag back | low | The owner ticked it; Sure keeps a toggled kind. | rejected |
| A one-time-only change leaves `updated_at` | low | Category and merchant edits do the same. | rejected |
| Statistics with an account filter dropped against the frozen intent | false | Sure's `scoped_result` returns no insights; recorded in Implementation Notes. | rejected |
| Budget e2e reads suggestions then clicks: race | false | `workers: 1`, `fullyParallel: false`. | rejected |
| `categoryStats` keys a vanished category id | false | `category_id` references `categories` with `onDelete: "restrict"`. | rejected |
| Sprint status `in-progress` while spec `in-review` | false | Completion syncs both. | rejected |
| No UI test of the viewer's disabled switch, no non-boolean test | low | The `fieldset` disables every field; QA screenshot shows it; Zod refuses a non-boolean. | rejected |
| `sideOf` in `domain/statistics.ts` repeats `domain/cash-flow.ts`'s | low | AD-9 defines the classification once. | patch |
| `edits.ts` repeats `sidesOf` | low | Same shape under other column names. | patch |
| `confirmTransfer` clears the flag | medium | Sure's `Transfer#confirm!` only sets `status`; a flag ticked on a pending side must survive. | patch |
| The API accepts `oneTime` on a split line or parent | low | Only a direct API call reaches it; Sure's controller permits `kind` on any transaction too. | rejected |
| `familyStats` only delegates; two grouping loops look alike | low | Judgement calls with no named harm. | rejected |

## Design Notes

One statistic, computed in the domain from the grouped rows `cashFlowByMonth` already returns (month, category, side): Sure's classification is per line, and a category's month-side sum is exactly what that query groups, so `FamilyStats` sums the categories and `CategoryStats` reads each one. No new SQL beyond dropping the bounds.

The statistics no longer depend on the month shown: Sure's `estimated_spending` and `median_expense(category:)` read the whole history. The budget's « Suggérer » keeps filling from them.

A boolean, not a `kind` column: Archant derives transfer kinds from `transfers`, so the only kind it lacks is `one_time`.

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck` -- expected: clean.
- `pnpm test` -- expected: both Vitest projects pass.
- `pnpm test:e2e` -- expected: green.

**Manual checks:**
- Screenshot the sheet's toggle as administrator and viewer, the list row's icon, and the budget page's medians before and after.

---
title: "Story 28.21: An activity label on investment transactions, as Sure"
type: 'feature'
created: '2026-10-17'
status: 'done'
baseline_commit: 'e748337c22aa67185664ff40bc7e8be5cdfde69d'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-28-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Sure gives a transaction of an investment or crypto account an activity type. Its drawer (`transactions/show.html.erb`, « Paramètres ») shows a « Type d'activité » select, `investment_activity_label`, offering « — » then `Transaction::ACTIVITY_LABELS`, saved at once by `auto-submit-form` and locked by `lock_saved_attributes!`. `IncomeStatement::ScopedTransactionsQuery#investment_activity_label_sql` leaves the four `INTERNAL_MOVEMENT_LABELS` (`Transfer`, `Sweep In`, `Sweep Out`, `Exchange`) out of the income statement, its daily totals and so the budget. Archant has no such label: a dividend reads as any income, and a sweep between a brokerage's cash and its fund counts as income and expense.

**Approach:** A nullable `transactions.investment_activity_label` column holding Sure's English values, a lockable field of the single edit, a select in the transaction sheet of an investment or crypto account that saves on change, and the cash-flow rule (`countsInCashFlow` and its SQL twin `countedInCashFlow`) leaving the four internal labels out.

## Boundaries & Constraints

**Always:**
- `ACTIVITY_LABELS` in `packages/data/schema/transactions.ts`, Sure's order and values: `Buy`, `Sell`, `Sweep In`, `Sweep Out`, `Dividend`, `Reinvestment`, `Interest`, `Fee`, `Transfer`, `Contribution`, `Withdrawal`, `Exchange`, `Other`; `INTERNAL_MOVEMENT_LABELS` = `Transfer`, `Sweep In`, `Sweep Out`, `Exchange`. A check constraint keeps the column in the list or null.
- `PATCH /api/transactions/:id` takes `investmentActivityLabel`, one of the list or `null`; any other value answers `VALIDATION_ERROR` on that field. A user write that changes it locks `investmentActivityLabel` in `locked_fields` (AD-10); another origin never writes a locked one. It moves no entry and no balance.
- Every transaction read (`TransactionRecord`) carries `investmentActivityLabel`.
- Cash flow (AD-9): a transaction labelled with an internal label counts in no cash-flow report, budget, median or daily total; any other label, or none, changes nothing. Balances, the list and its totals keep it, as Sure's.
- The sheet of an existing transaction on an `investment` or `crypto` account, for an administrator, shows « Type d'activité » with « Type d'activité d'investissement (Achat, Vente, Dividende, etc.). » under it, and a select of « — » then the thirteen labels in Sure's French (`transactions.activity_labels.*`): « Achat », « Vente », « Balayage entrant », « Balayage sortant », « Dividende », « Réinvestissement », « Intérêts », « Frais », « Transfert », « Contribution », « Retrait », « Échange », « Autre ». It sits between « Exclure » and « Transaction ponctuelle », as Sure's settings. Choosing saves at once through its own `PATCH`, apart from « Enregistrer »; a refusal shows the error toast and the select returns to the saved value.
- The protection block names the lock « Type d'activité ».
- `docs/sure-parity.md` gains a Transactions row « Investment activity label », Parity; AD-9 names the internal labels.

**Never:** no label on the export or in `get_transactions`, nor in `update_transaction`, the bulk edit, splits or the creation form, as Sure's exporter, assistant functions, `bulk_update!`, `Entry#split!` and new-transaction form carry none; no list badge (Sure's `investment_activity/_quick_edit_badge`); no rule action (Story 32.8); no label on trades; no new dependency.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Label a dividend | PEA line +12,00, `Dividend` | saved, `locked_fields.investmentActivityLabel` stamped; still income in the month | none |
| Clear it | `null` | saved null, lock renewed | none |
| Unknown value | `"Gift"` | nothing written | `VALIDATION_ERROR` `investmentActivityLabel` |
| Internal label | line labelled `Sweep In`, `Sweep Out`, `Transfer` or `Exchange` | left out of the month's cash flow, the budget's actuals and daily totals; kept in the balance | none |
| Locked against others | label locked, a non-user write sends another label | label unchanged | none |
| Sheet, checking account | transaction of a depository | no « Type d'activité » | none |
| Sheet, viewer | investment line | no select | none |

</frozen-after-approval>

## Code Map

- `packages/data/schema/transactions.ts` -- `ACTIVITY_LABELS`, `INTERNAL_MOVEMENT_LABELS`, `ActivityLabel`, column `investmentActivityLabel` with its check; `LOCKABLE_FIELDS` gains `investmentActivityLabel`.
- `packages/data/drizzle/0084_*.sql` -- generated by `pnpm data generate`.
- `packages/api/src/services/ledger/patch.ts` -- `TransactionPatch.investmentActivityLabel`, `PATCH_KEY_OF`, `editableColumns`, `detailOf`.
- `packages/api/src/services/ledger/edits.ts` -- the label does not touch the entry.
- `packages/api/src/services/ledger/queries.ts` -- `transactionColumns`, `TransactionRecord`, `countedInCashFlow`.
- `packages/api/src/domain/cash-flow.ts` -- `CountedTransaction` and `countsInCashFlow`.
- `packages/api/src/schemas/transactions.ts` -- `transactionPatchBodySchema`, `updateTransactionSchema`.
- `packages/api/src/testing/app.ts` -- `listItem` if it must list the field.
- `packages/app/src/components/ActivityLabelField.tsx` (new) -- the select that saves on change; `TransactionForm.tsx` mounts it.
- `packages/app/src/lib/locked-fields.ts`, `packages/app/src/locales/fr.json`.
- Specs: `domain/cash-flow.spec.ts`, `services/ledger/queries.spec.ts` (parity test), `services/ledger/edits.spec.ts`, `routes/transactions.spec.ts`, `services/reports.spec.ts` or `routes/reports.spec.ts` and `routes/budgets.spec.ts`; `app/e2e/investments.spec.ts` or `operations.spec.ts`.
- `docs/architecture.md` (AD-9), `docs/sure-parity.md`.
- Sure, read-only, at `00dd977fb`: `app/models/transaction.rb`, `app/views/transactions/show.html.erb`, `app/controllers/transactions_controller.rb#update`, `app/models/income_statement/{scoped_transactions_query,totals,daily_expense_totals}.rb`, `app/models/family/data_exporter.rb`, `app/models/assistant/function/get_transactions.rb`, `config/locales/views/transactions/fr.yml`.

## Tasks & Acceptance

**Execution:**
- [x] Vitest first, failing: `cash-flow.spec.ts` (each internal label left out, `Dividend` counted), the queries parity test with labelled rows, `edits.spec.ts` (saved, locked, a non-user origin blocked, no balance recompute), `routes/transactions.spec.ts` (PATCH saves and returns it, unknown value refused, viewer refused), a reports or budget spec showing a `Sweep In` line out of the month.
- [x] Schema, migration, ledger, schemas, queries, cash flow.
- [x] `ActivityLabelField`, the sheet, locked-field name, locales.
- [x] Playwright: label a PEA transaction « Dividende » from its sheet, reopen it and read it, and see the lock listed.
- [x] AD-9, parity row.

**Acceptance Criteria:**
- Given the finished story, when `pnpm test` and `pnpm test:e2e` run, then both pass, and the sheet's select is screenshotted light and dark, desktop and phone width, beside Sure's drawer.

## Implementation Notes

- `ACTIVITY_LABELS`, `INTERNAL_MOVEMENT_LABELS` and `ActivityLabel` live in `packages/data/activity-labels.ts`, not in `schema/transactions.ts` as the Code Map said: AD-2's `no-restricted-imports` keeps the domain, the schemas and the interface off the table modules, as `transfer-kinds.ts` already does.
- The migration rebuilds `transactions`, as drizzle-kit does for a table check and as 0070 did; its `INSERT` was edited by hand, since drizzle-kit copied the new column from the old table.
- `CLASSIFYING_FIELDS` in `services/ledger/edits.ts` names what moves no entry and no balance: category, merchant, tags and the label.
- The export lists the column in `LEFT_OUT` with Sure's reason.
- The matrix's « Label a dividend » row says a PEA line stays income in the month; a PEA is tax-advantaged and never counts in cash flow (AD-9), so the report and budget specs use a `brokerage` account, and the PEA keeps the label and lock tests.
- Screenshots of the select, closed and open, light and dark, at 1280 and 390 px, were reviewed against Sure's `transactions/show` settings row: title and description left, select right.

### Review Findings

- [x] [Review][Patch] The export wrote the label's lock in `archant.locked_fields` but left the label out [packages/api/src/services/export.ts, packages/api/src/services/ledger/export.ts]: it now leaves under `archant.investment_activity_label`, as every field Sure's exporter has none for (`docs/deployment.md`), Sure's own keys untouched.
- [x] [Review][Patch] The database check test accepted any error [packages/api/src/services/ledger/edits.spec.ts]
- [x] [Review][Patch] The refused-label e2e test did not check the select comes back enabled [packages/app/e2e/transactions.spec.ts]
- [x] [Review][Defer] Sure's `FamilyStats` and `CategoryStats` keep the internal labels in the medians; Archant's statistics read the month's counted rows, so they leave them out. Recorded as Later in `docs/sure-parity.md` and AD-9, and in `deferred-work.md`.

Rejected:
- The select shows on a split's parent and lines (false): Sure's drawer shows it there too.
- The sheet reads the chosen account rather than the transaction's (false): an edit's account is fixed; only a new transaction picks one, and the select shows on edits only.
- A viewer cannot read the label (low): Sure's settings section is `can_edit_entry?` only.
- The lock key is camel case (low): `locked_fields` keys are `LOCKABLE_FIELDS` names, as `category` for `category_id`.
- The select's state is not resynced to a refetch while the sheet stays open (low): only another tab could change it meanwhile.
- `listItem` lacks the field; the migration test sits under « recurring transactions » beside 0070's; the clear test does not compare lock times; no sync test keeps the label (low): the ledger tests cover the lock renewal and the non-user origin; no sync or import writes the label.
- Tracking out of step and the Code Map's old location (false): statuses move to done together; the Implementation Notes record the move.

## Spec Change Log

- Code review: the frozen Never lists « no label on the export ». Sure's `Transaction` line has no field for it, and the export's rule puts such a field under `archant` (`docs/deployment.md`, « What Sure has no field for … goes in `all.ndjson` under an `archant` key »); leaving it out lost a user's choice while its lock was exported. The label now leaves under `archant.investment_activity_label`; Sure's own keys stay as Sure's. The medians row of the matrix's intent (« counts in no … median ») is kept and recorded as a departure from Sure, Later.

## Review Triage Log

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | The API takes a label on any account, and a checking line labelled `Transfer` leaves cash flow with no control to clear it | low | reject | Sure's `transactions_controller#entry_params` permits `investment_activity_label` on every transaction and its model validates nothing; only its drawer limits the select to investment and crypto accounts. An account's type never changes in Archant. |
| 2 | A split's lines lose the parent's label | false | reject | Sure's `Entry#split!` copies `merchant_id` and `kind`, never `investment_activity_label` (`app/models/entry.rb:470-473`). |
| 3 | No test of a migrated database keeping its transactions through 0084's rebuild | medium | patch | `migrate.spec.ts` covers 0012 and 0070's rebuilds of `transactions`, nothing for 0084, whose `INSERT` was edited by hand. |
| 4 | The crypto branch of the sheet's condition is never exercised | low | patch | Only a PEA, a checking account and a viewer are tested. |
| 5 | The viewer test does not read the label back | low | patch | It checks the locks only. |
| 6 | `updateTransaction`'s comment: a line past the width, and the lock sentence omits the label | low | patch | Direct correction. |
| 7 | Stale comment in the queries parity test | low | patch | The added `Dividend` row joins the uncategorised income group. |
| 8 | Monthly statistics and daily totals untested with a label | low | reject | Both read `cashFlowKeyed`, built on the same `countedInCashFlow` the parity test ties to `countsInCashFlow`. |
| 9 | The budget test's figures are fixed numbers | low | reject | The fixture's sums are stable and the other budget tests read them the same way. |
| 10 | The select and « Enregistrer » can send two requests at once | low | reject | They write disjoint fields; each invalidates the same queries. |
| 11 | The comment `Only this edit sets it` contradicts the rule-origin ledger test | false | reject | The comment is about the HTTP body; the ledger test checks AD-10's lock rule for any origin, which Story 32.8 will use. |
| 12 | The query plans of NFR10 were not rerun | false | reject | `pnpm test` runs the `volume` project, which passed. |

## Design Notes

Assumptions taken alone, each settled by Sure. The epic's third criterion asks the export and `get_transactions` to carry the label « as Sure's exporter and `get_transactions` do », but at `00dd977fb` neither does: `Family::DataExporter`'s `Transaction` line lists id, entry, account, date, amount, currency, name, notes, excluded, category, merchant, tags, kind and times, and `GetTransactions` lists name, date, amount, classification, account, notes, category, merchant, tags and `is_transfer`. Both stay as they are, as Sure's, and as the rule that assistant outputs match Sure field by field. The select shows on crypto accounts too, Sure's `investment? || crypto?`. Sure's description continues « Détecté automatiquement ou défini manuellement. »; no Archant sync or rule sets the label yet, so the sentence would be false and is left out until Story 32.8. Values are stored as Sure stores them, in English, so an export or a later Sure import reads them alike. Sure's column takes any string; the API takes only the list, as Sure's select offers and its rule action checks.

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test && pnpm test:e2e` -- all green, no tracked file changed after.

---
title: 'Story 5.1: Mark two transactions as a transfer'
type: 'feature'
created: '2026-09-23'
status: 'done'
baseline_commit: '9d4c39306c5b5ee2a1c3de7fd35fd6b5d6e9c278'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/scaffolding-lessons.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Money moved from the checking account to the Livret A, or used to pay the credit card, shows as an expense on one side and an income on the other: nothing links the two rows, and the list cannot tell income, expense and transfer apart (FR21, FR32, FR33).

**Approach:** Add a `transfers` table written only by the ledger, a manual match from the transaction sheet that lists the candidates and saves the picked one, « Dissocier » to undo, and a « Sens » filter on `/operations` driven by one `direction` rule shared with the future dashboard.

## Boundaries & Constraints

**Always:**
- Schema `packages/data/schema/transfers.ts`: `transfers (id, outflow_transaction_id, inflow_transaction_id, kind, created_at)`, both ids FK to `transactions.entry_id` `ON DELETE RESTRICT`, each unique, check `outflow <> inflow`, `kind` checked against `TRANSFER_KINDS = ["internal_move", "credit_card_payment", "loan_payment", "investment_contribution"]`. Migration `0015` from `pnpm --filter @archant/data generate`. Add the schema to the oxlint restricted imports as `schema/transactions`.
- `domain/transfer-matching.ts`, pure: `isTransferCandidate(a, b)` is true when both are transactions, amounts are non-zero and sum to 0, accounts differ, currencies match, `daysBetween` ≤ `TRANSFER_WINDOW_DAYS` = 4, and neither is in a transfer. `transferKindOf(inflowAccountType)`: `credit_card` gives `credit_card_payment`, anything else `internal_move`. The outflow is the negative side (money leaves the account), on assets and liabilities alike.
- `domain/cash-flow.ts`: `direction(tx)` returns `transfer` for a transaction in a transfer, except the outflow of a kind in `EXPENSE_TRANSFER_KINDS` (`loan_payment`, `investment_contribution`); otherwise `income` when the amount is positive, `expense` when it is negative or zero. Exclusion and account settings do not change direction. `countsInCashFlow` waits for Epic 6.
- Ledger, each in one `behavior: "immediate"` transaction with an `origin`: `transferCandidates(deps, transactionId)` (SQL prefilter on account, currency, opposite amount, date window, unmatched; then `isTransferCandidate`), `matchTransfer(deps, transactionId, counterpartId, { origin })`, which re-checks `isTransferCandidate` inside the transaction, and `unmatchTransfer(deps, transferId, { origin })`. Matching and unmatching move no balance and touch no category, lock or tag.
- Every path that deletes a transaction deletes its transfer first, the other side becoming a standard transaction again: `deleteTransaction`, `bulkDeleteTransactions`, `revertImport`, `deleteAccount` (replace its Epic 5 comment). `updateTransaction` deletes the transfer when the amount changes; a date change keeps it, as in Sure.
- The direction filter's SQL lives beside `filterCondition` in `ledger.ts`, built from `EXPENSE_TRANSFER_KINDS`, since money tables are read only there; a parity test runs `direction` and the filter over one fixture of every case and expects the same partition.
- List and single-row records gain `transfer: { id, kind, counterpartAccountId, counterpartAccountName } | null`, read with a left join on the two unique indexes.
- API: `GET /api/transactions/:id/transfer-candidates` → `{ data: Candidate[] }` (id, date, label, amount, currency, accountId, accountName), closest date first. `POST /api/transfers` `{ transactionId, counterpartId }` → 201 `{ data: transfer }`. `DELETE /api/transfers/:id`, answered as `DELETE /api/transactions/:id`. Unknown transaction or transfer: 404 `NOT_FOUND`. Counterpart not a candidate, already matched included: 400 `VALIDATION_ERROR`, path `counterpartId`, code `not_a_candidate`. New `routes/transfers.ts` and `services/transfers.ts`, one service call per route.
- Filter `direction`: repeated `income | expense | transfer`, in `filterFields` (so `bulkFilterSchema` takes it), `TransactionFilter`, `filterOf`, `operationsSearchSchema`, `toApiQuery` and the bulk body. Chip « Sens » with Revenus, Dépenses, Virements.
- Row of a transfer side, as in Sure and `key-transactions.html` 600-610: caption « Vers {compte} » on the outflow, « Depuis {compte} » on the inflow, in place of the merchant caption; a static chip in place of the category chip, dot `#7A5AF8`, « Virement » or « Remboursement de carte ». `c` does nothing on such a row.
- Sheet: a « Virement » block under the source. Unmatched: « Rapprocher un virement » opens a dialog listing candidates (account, date, label, amount); picking one saves and closes it; no candidate shows « Aucune opération de montant opposé dans un autre compte à 4 jours près ». Matched: « Vers/Depuis {compte} » and « Dissocier ». The category field is hidden for a transfer side. Success and failure use the existing toasts; queries `transactions.all` invalidated, no optimistic update.

**Never:** no `rejected_transfers` and no « Ne plus proposer » (Story 5.2); no automatic matching; no creation of the missing counterpart; no cross-currency match; no `kind` column on `transactions`; no `services/reports.ts` yet; no `ON DELETE cascade`; no new shortcut.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Candidates | −500 checking day 0; +500 Livret day 4; +500 Livret day 5; +500 checking day 1; +499 Livret day 1 | Only the day-4 row | — |
| Match to savings | −500 checking, +500 Livret | Transfer, outflow checking, `internal_move`; balances unchanged | — |
| Match card payment | −300 checking, +300 card | `credit_card_payment` | — |
| Already matched | Counterpart in another transfer | Nothing written | 400 `counterpartId` `not_a_candidate` |
| Other currency | −500 EUR, +500 USD | Not listed | 400 if posted |
| Zero | 0 and 0 in two accounts | Not listed | 400 if posted |
| Unmatch | Existing transfer | Row deleted, both sides standard | 404 when unknown |
| Delete a side | Single, bulk, revert, account | Transfer gone, other side standard | — |
| Edit amount | Matched side −500 → −450 | Transfer gone | — |
| Direction | Standard −20, +30, 0; internal move both sides; card payment both sides; loan payment outflow | expense, income, expense; transfer ×4; expense | — |

</frozen-after-approval>

## Code Map

- `packages/data/schema/transactions.ts` -- table 31-80, check pattern 71-78; `schema/check.ts:10` `inList`. `account-types.ts` `ACCOUNT_TYPES` 10, only `credit_card` is a liability. `types.ts` and `package.json` exports 6-27 for the new schema. `migrate.spec.ts` checks refused enum values.
- `.oxlintrc.json` -- restricted `schema/transactions` entries at 73, 118, 178, 231; ledger allowance at 248.
- `packages/api/src/domain/dates.ts` -- `daysBetween`. `domain/keys.ts` `MATCH_WINDOW_DAYS` is the import window, not this one.
- `packages/api/src/services/ledger.ts` -- `Origin` 65; `ingest` step-6 comment 878 stays for 5.2; `updateTransaction` 1090 (amount write 1150-1155); `deleteTransaction` 1186; `selectedRows` 1232; `bulkDeleteTransactions` 1375; `revertImport` 1617 (deleted ids 1652-1672); `deleteAccount` 1745 (comment 1742); `TransactionRecord` 1832, `TransactionListRecord` 1853, `transactionColumns` 1855, `findTransaction` 1903; `TransactionFilter` 1946, `needsTransactionColumns` 1977, `filterCondition` 2030 (tag `exists` is the model), `listTransactions` 2075, `sumTransactions` 2120.
- `packages/api/src/services/transactions.ts` -- `withSources` 71, `filterOf` 204-215. `schemas/transactions.ts` -- `filterFields` 212, `bulkFilterSchema` 279 (strict). `routes/transactions.ts` -- `/:id` routes last. `app.ts` chained mounts. `lib/errors.ts` needs no new code.
- Tests: `ledger.spec.ts` `deps` 56, `add` 225, `openPair` 2268, delete block 2177; `app.spec.ts` `request` 246, `openAccount` 256, `postTransaction` 266.
- `packages/web/src/components/TransactionList.tsx` -- `CategoryChip` 87, merchant caption 379-383, `c` handler. `TransactionSheet.tsx` -- header and source 644-660, category field 470, delete confirm 529-555. `hooks/useTransactions.ts` -- `useDeleteTransaction` 224 as the mutation model. `lib/transaction-filters.ts` -- `operationsSearchSchema` 23, `FILTER_KINDS` 86, `PARAMS_OF` 90, `toApiQuery` 120, `filterChips` 207. `TransactionFilters.tsx` -- one editor per kind. `locales/fr.json` -- `transactions` 184, `operations.kinds` 258, `operations.chips` 275.
- `packages/web/e2e/fixtures.ts` -- `apiHelpers` 140, `addTransaction` 142, `openAccount` 149 (`kind: "credit_card"`).

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/domain/transfer-matching.spec.ts`, `cash-flow.spec.ts` -- failing tests first, every branch, 4 days in and 5 out.
- [x] `packages/api/src/domain/transfer-matching.ts`, `cash-flow.ts` -- pure rules.
- [x] `packages/data/schema/transfers.ts`, `types.ts`, `package.json`, `drizzle/0015_*`, `migrate.spec.ts`, `.oxlintrc.json` -- table, migration, refused kind, import restriction.
- [x] `packages/api/src/services/ledger.spec.ts` -- failing tests for every matrix row and the direction parity.
- [x] `packages/api/src/services/ledger.ts` -- candidates, match, unmatch, transfer cleanup on every delete path and amount edit, `transfer` on records, direction condition.
- [x] `packages/api/src/schemas/transfers.ts`, `schemas/transactions.ts`, `services/transfers.ts`, `services/transactions.ts`, `routes/transfers.ts`, `routes/transactions.ts`, `app.ts`, `app.spec.ts` -- routes, filter field, route rows of the matrix.
- [x] `packages/web/src/hooks/useTransfers.ts` -- candidates query, match and unmatch mutations.
- [x] `packages/web/src/components/TransactionList.tsx`, `TransactionSheet.tsx`, `TransferDialog.tsx`, `locales/fr.json` -- caption, chip, sheet block, dialog.
- [x] `packages/web/src/lib/transaction-filters.ts`, `components/TransactionFilters.tsx` -- « Sens » chip and editor.
- [x] `packages/web/e2e/transfers.spec.ts` -- one test per criterion below.

**Acceptance Criteria:**
- Given −500 on « Compte courant » and +500 on « Livret A » three days later, plus +500 on the Livret six days later, when I open the first row's sheet and press « Rapprocher un virement », then only the three-day row is offered.
- Given that pair, when I pick it, then the checking row shows « Vers Livret A » and « Virement », and the Livret row « Depuis Compte courant ».
- Given −300 on the checking account and +300 on a credit card, when I match them, then both rows show « Remboursement de carte ».
- Given a matched pair, when I press « Dissocier », then both rows show their category chip again and no caption.
- Given a matched pair, a −20 expense and a +30 income, when I filter « Sens » on Virements, then only the pair is listed; on Dépenses, only −20; on Revenus, only +30; and the chip survives a reload.

## Implementation Notes

- `TRANSFER_KINDS` and `EXPENSE_TRANSFER_KINDS` live in `packages/data/transfer-kinds.ts`, which `schema/transfers.ts` imports for its check. The schema module is restricted in `packages/api/src/domain/**` to type imports, and `domain/cash-flow.ts` needs the values.
- An unknown `counterpartId` answers 400 `not_a_candidate`, as it is a body field; only an unknown `transactionId` answers 404.
- « Sans catégorie » leaves transfer sides out, as Sure's `uncategorized_condition` does: they show no category and cannot be given one.
- A bulk category change skips transfer sides, their category, origin and lock untouched; the other patch fields still apply to them.
- The sheet keeps the transfer it last saved in local state, since the row it was opened with is a snapshot and a filtered list may drop the refreshed row.

## Spec Change Log

## Review Triage Log

| # | Layer | Finding | Verdict | Evidence | Route |
|---|---|---|---|---|---|
| 1 | blind | `sprint-status.yaml` says in-progress while the spec says in-review | false | The workflow moves the story to `review` at the present step, by design | reject |
| 2 | blind, edge | Bulk category writes a hidden category onto transfer sides | medium | `bulkUpdateTransactions` applied `categoryId` to every selected row; « Tout sélectionner » on « Sans catégorie » reached them | patch |
| 3 | blind | « Sans catégorie » lists transfer sides, which cannot be categorised | medium | `categoryCondition` read `isNull(categoryId)` only; Sure's `uncategorized_condition` excludes transfer kinds | patch |
| 4 | blind | Editing the amount unlinks the transfer without a warning | false | Required by AD-11 and the frozen matrix; `changeOf` keeps only fields that differ, so an unchanged amount keeps it | reject |
| 5 | blind, edge | A date moved past 4 days keeps the transfer | false | Intended: the frozen block keeps a transfer on a date change, as in Sure | reject |
| 6 | blind, edge | A refused match keeps the stale candidate listed | low | `useMatchTransfer` invalidated on success only; one-line fix | patch |
| 7 | blind | A refused match shows the generic validation toast | low | Needs a candidate taken between listing and picking, in a single-household app | reject |
| 8 | blind | « 4 jours » is written in the translation, not interpolated | low | The constant is fixed by AD-11; interpolating means exporting it to the interface | reject |
| 9 | blind, verification-gap | The no-candidate message is untested | low | No test opened the picker with no candidate; one assertion in the first e2e test | patch |
| 10 | blind | `origin` is ignored and not stored | low | No column in AD-11; Story 5.2 adds what rejection needs | reject |
| 11 | blind | The four transfer joins are written twice | low | `findTransaction` and `listTransactions` each have them; no divergence today | reject |
| 12 | blind | `app.spec.ts` checks `kind` with `z.string()` | low | A value outside `TRANSFER_KINDS` would pass the route tests; direct correction | patch |
| 13 | blind | One unknown `direction` value drops the whole filter | low | Same `.catch(undefined)` rule as every other search param | reject |
| 14 | edge | A category changed in the sheet, then hidden by a match, is still sent | low | The save sent `categoryId` whenever dirty; one guard | patch |
| 15 | edge | « Dissocier » on a transfer already gone leaves the sheet stuck | low | `NOT_FOUND` only toasted; `onChange(null)` fixes it | patch |
| 16 | edge | Random e2e amounts may collide across tests | low | Six-digit random cents within a 4-day window; no flake seen | reject |
| 17 | verification-gap | No test saves a transfer side with its unchanged amount | medium | The sheet always sends `amount`; a guard on `patch.amount !== undefined` would pass every test | patch |
| 18 | verification-gap | A transaction could be the outflow of one transfer and the inflow of another | false | The outflow is the negative side and `isTransferCandidate` refuses a side already matched, inside the immediate transaction | reject |

## Design Notes

`direction` cannot filter a paginated SQL list by itself, so the rule is held twice, once in TypeScript and once in SQL, both built from `EXPENSE_TRANSFER_KINDS`, with a parity test as the tie. AD-9 places the SQL in `services/reports.ts`, but only `ledger.ts` may import the money tables and every read of them already lives there; Epic 6 decides whether reports read through the ledger or get the same oxlint allowance.

`loan_payment` and `investment_contribution` exist in `TRANSFER_KINDS` and in `direction` now, so Epic 7 adds account types, not a migration.

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test && pnpm test:e2e` -- all pass, no tracked file modified afterwards.

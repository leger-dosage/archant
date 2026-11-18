---
title: 'Story 5.2: Automatic transfer matching'
type: 'feature'
created: '2026-09-23'
status: 'done'
baseline_commit: 'f952ac9f0f8ba8fd4ec51c15f170ea2c2bdfca8a'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/scaffolding-lessons.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** After an import, every move to the Livret A or card repayment still has to be matched by hand, and a wrong match can only be undone, so it keeps coming back as a candidate (FR31, FR32).

**Approach:** Step 6 of `ledger.ingest` links each new transaction that forms a mutually unique pair with an existing one; a transaction with two or more candidates shows « Virement possible »; « Ne plus proposer » on a linked transfer undoes it and records the pair in `rejected_transfers`, which every candidate search then skips.

## Boundaries & Constraints

**Always:**
- Schema `packages/data/schema/rejected-transfers.ts`: `rejected_transfers (id, outflow_transaction_id, inflow_transaction_id, created_at)`, both FK to `transactions.entry_id` `ON DELETE RESTRICT`, unique on the pair, check `outflow <> inflow`. Migration `0016` from `pnpm --filter @archant/data generate`. Export it in `types.ts` and `package.json`, and restrict it in `.oxlintrc.json` like `schema/transfers`.
- A candidate is what 5.1 defines, and the pair is not in `rejected_transfers`. One SQL prefilter, extracted from `transferCandidates` and extended with `not exists` on `rejected_transfers`, serves the picker, `matchTransfer`'s re-check and step 6. `matchTransfer` refuses a rejected pair with `not_a_candidate`.
- Pure `mutualMatches(newIds, candidatesOf)` in `domain/transfer-matching.ts`: a pair `(n, c)` is returned when `n` has exactly one candidate `c` and `c` has exactly one candidate, `n`; each pair once.
- Step 6, inside the ingest transaction, after inserts and before the statement balance: read the candidates of every created entry and of each unique candidate, all before writing anything, then write every pair from `mutualMatches` with the outflow and kind rule of `matchTransfer`. Reading first keeps the result independent of line order. Runs for imports and manual entries, never for `dryRun`, edits or bulk edits. Moves no balance, category, lock or tag.
- `rejectTransfer(deps, transferId, { origin })`, one `behavior: "immediate"` transaction: delete the transfer, insert its pair into `rejected_transfers`. Unknown id: 404 `NOT_FOUND`. Route `POST /api/transfers/:id/reject`, answered as `DELETE /api/transfers/:id`.
- Every path that deletes a transaction also deletes its `rejected_transfers` rows, beside the existing `transferOf` cleanup: `deleteTransaction`, `bulkDeleteTransactions`, `revertImport`, `deleteAccount`.
- List and single-row records gain `transferSuggested: boolean`: true when the row is in no transfer and has two or more candidates. Computed in the list query, only for unmatched rows; the 50,000-row first page stays under 300 ms.
- Row with `transferSuggested`: a neutral flag « Virement possible » beside the label, the pattern of « Doublon possible » without the warning colour, which `DESIGN.md` reserves. Sheet, unmatched and suggested: « Plusieurs opérations pourraient former l'autre côté de ce virement. » above « Rapprocher un virement ». Sheet, matched: « Ne plus proposer » beside « Dissocier ». Strings in `locales/fr.json`, toasts and invalidation as in 5.1.
- The 5.1 fixtures that create an opposite pair through `ingest` or the API now get it linked on creation. Those that need it unlinked unmatch it first; a test asserts the automatic link where it applies.

**Never:** no `status` column and no confirm action (Sure's `pending`/`confirmed`); no badge telling automatic from manual links; no matching in the import preview, the stale check or the confirm toast; no backfill of existing transactions; no way to dismiss a suggestion or to undo a rejection; no cross-currency match; no `ON DELETE cascade`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Unique pair | −500 checking day 0, then +500 Livret day 4 created | Linked, `internal_move` | — |
| Window edge | +500 Livret day 5 created | Not linked, no flag | — |
| Card | −300 checking, then +300 card | Linked, `credit_card_payment` | — |
| Two candidates | −500 checking, then +500 Livret and +500 card imported | Nothing linked, checking row flagged | — |
| Not mutual | +500 Livret day 0 and −500 joint day −4, left unlinked with « Dissocier »; then −500 checking day 4 created | Checking has one candidate, the Livret two: nothing linked, Livret flagged | — |
| Same file | OFX with −500 and +500 on one account | Not linked | — |
| Rejected pair | Pair rejected, same amounts recreated elsewhere | Rejected pair never offered or linked, other pairs still are | 400 `not_a_candidate` if posted |
| Reject | Linked pair | Transfer gone, pair in `rejected_transfers` | 404 when unknown |
| Delete a side | Side of a rejected pair, by any delete path | Transaction and rejected row gone | — |
| Dry run | Preview of a file holding a unique pair | Nothing written, groups unchanged | — |

</frozen-after-approval>

## Code Map

- `packages/data/schema/transfers.ts` -- model for the new table, restrict comment included. `transfer-kinds.ts` unchanged. Latest migration `drizzle/0015_add_transfers.sql`. `.oxlintrc.json` 57-97 lists restricted schema modules.
- `packages/api/src/domain/transfer-matching.ts` -- `TRANSFER_WINDOW_DAYS` 15, `TransferSide` 18, `isTransferCandidate` 35 (doc already names 5.2), `transferKindOf` 53.
- `packages/api/src/services/ledger.ts` -- `transferOf` 153; `IngestResult` 398 (its `matched` means key-matched lines, not transfers); `ingest` 706-922: dry run returns at 827, inserts 838-869 (`rows[].id`), step-6 comment 899, balance recompute 905; delete cleanup at 1181, 1228, 1431, 1703, 1803-1808; `inAnyTransfer` 1889, `sideColumns` 1891, `transferSide` 1903; `transferCandidates` 1927 (prefilter 1948-1960); `matchTransfer` 1994 (re-check 2010, outflow 2014); `unmatchTransfer` 2035; `TransactionRecord` 2055, `TransferLink` 2081, `TransactionListRecord` 2089, `withTransferLink` 2133, joins 2188 and 2396.
- `packages/api/src/services/transactions.ts` -- `createTransaction` 248 ingests one manual line with `origin: "user"`; `services/imports.ts` uses `"sync"`. `services/transfers.ts`, `routes/transfers.ts` -- add reject beside delete.
- `packages/web/src/components/TransactionSheet.tsx` -- `TransferBlock` 288-382. `TransactionList.tsx` -- `TransferChip` 141, caption 345; « Doublon possible » is not built yet, so the flag is new markup (`key-transactions.html` 630). `hooks/useTransfers.ts` -- model for `useRejectTransfer`. `locales/fr.json` 252-271.
- Tests: `ledger.spec.ts` `add` 231, `importStatement` 561, `openHousehold` 3851, `insertTransfer` 3877, transfer describes 3887-4255; `app.spec.ts` `household()` 4150; `e2e/transfers.spec.ts` `moveToSavings` 47; `e2e/fixtures.ts` `importFile` 206.

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/domain/transfer-matching.spec.ts` -- failing tests for `mutualMatches`, every branch.
- [x] `packages/api/src/domain/transfer-matching.ts` -- `mutualMatches`.
- [x] `packages/data/schema/rejected-transfers.ts`, `types.ts`, `package.json`, `drizzle/0016_*`, `migrate.spec.ts`, `.oxlintrc.json` -- table, migration, restriction.
- [x] `packages/api/src/services/ledger.spec.ts` -- failing tests for every matrix row; adjust 5.1 fixtures.
- [x] `packages/api/src/services/ledger.ts` -- shared prefilter, step 6, `rejectTransfer`, rejected cleanup on delete paths, `transferSuggested`.
- [x] `packages/api/src/services/transfers.ts`, `routes/transfers.ts`, `app.spec.ts` -- reject route, route rows of the matrix, adjusted `household()`.
- [x] `packages/web/src/hooks/useTransfers.ts`, `components/TransactionList.tsx`, `TransactionSheet.tsx`, `locales/fr.json` -- flag, sheet text, « Ne plus proposer ».
- [x] `packages/web/e2e/transfers.spec.ts` -- adjust `moveToSavings`, one test per criterion below.

**Acceptance Criteria:**
- Given −500 on « Compte courant », when I add +500 on « Livret A » three days later, then both rows show « Virement » and « Vers / Depuis » without any match by hand.
- Given −500 on the checking account, when an OFX file adds +500 to the Livret A, then the rows are linked after the confirm.
- Given −500 on the checking account and +500 on two other accounts, then the checking row shows « Virement possible », and its sheet shows the suggestion and lists both candidates.
- Given an automatic link, when I press « Ne plus proposer », then both rows are standard again and the picker of either side no longer lists the other.

## Implementation Notes

- The « Two candidates » row cannot happen in the order it is written: each import targets one account, so importing the Livret's +500 after the checking's −500 links that pair at once. The test creates the Livret and card inflows first, then the checking outflow; the expected outcome is unchanged.
- `rejected_transfers` also has an index on `inflow_transaction_id`: the pair index starts with the outflow, and deleting an inflow side needs its own.
- The candidate prefilter, `candidateOf`, excludes a rejected pair in both orders, so `matchTransfer` answers `not_a_candidate` on it.
- Tests share one database, and the candidate search spans every account: fixtures that need an unlinked pair use `addStandard` (API specs) or `api.unlinkTransfer` and `moveToSavings(…, { unlinked: true })` (end to end), and the direction filter tests use unique amounts.
- `transferSuggested` is computed after the page query, for the page's unmatched rows only, through `candidatePairs`, so it agrees with the picker.

## Spec Change Log

## Review Triage Log

| # | Layer | Finding | Verdict | Evidence | Route |
|---|---|---|---|---|---|
| 1 | blind, verification-gap | The suggestion subquery runs on every filtered row before the sort, and the 50,000-row test never meets a candidate | medium | A correlated column in the SELECT is computed for each row fed to the sorter when the order is not index-covered; the fixture's amounts are all negative | patch |
| 2 | blind | The suggestion counts with the SQL prefilter only, not `isTransferCandidate` | low | Fixed by counting through `candidatePairs`, as the picker does | patch |
| 3 | blind, edge | « Ne plus proposer » on a transfer already gone elsewhere records no rejection | low | Needs a second tab unlinking the same pair in a single-household app; the fix adds a branch | reject |
| 4 | blind | « Ne plus proposer » is irreversible and has no confirmation | low | Sure's reject button has none either; a mistaken rejection only removes one pair from the picker | reject |
| 5 | blind, edge | The sheet's suggestion text reads the row it was opened with, so it is stale after an unlink or reject in the same sheet | low | The list row refreshes; only the open sheet lags, and fixing it needs a refetch | reject |
| 6 | blind | `0016_snapshot.json` is not in the reviewed diff | false | Left out of the review diff on purpose; generated by drizzle-kit alongside the migration | reject |
| 7 | blind | `sprint-status.yaml` says in-progress while the spec says in-review | false | The present step moves the story to `review`, by design | reject |
| 8 | blind | `mutualMatches` documents and tests two new rows picking each other, which one-account ingest cannot produce | low | Harmless: the branch keeps the pure function correct for any input | reject |
| 9 | blind | Step 6 adds queries under the write lock without a large-import benchmark | low | Measured 160 ms to 470 ms for 3,600 lines on 50,000 rows with repeated amounts | reject |
| 10 | blind | Tests read a row through an empty `PATCH` | low | `changeOf` writes nothing for an empty patch; no read route exists and adding one is out of scope | reject |
| 11 | edge | A line flagged as a possible duplicate can be linked as a transfer side | low | Mutual uniqueness already blocks it whenever its twin is itself a candidate; the remaining case is a real opposite movement | reject |

## Design Notes

Epic AC 1 says "exactly one candidate"; AD-11 and the epic context require mutual uniqueness, which this spec follows. It also avoids linking the first of two incoming rows when two outflows compete for it.

Sure picks the closest date when a transaction has several candidates, stores auto links as `pending` with an « Auto-matched » pill and confirm/reject buttons, and offers no suggestion. Archant's planning replaces this with mutual uniqueness, a suggestion and « Ne plus proposer » on any link, so no status column is needed. Sure's manual picker still lists rejected pairs; Archant's does not, per the epic context.

Suggestion threshold: two candidates, as the AC says. A pair unlinked with « Dissocier », or created before this story, has one candidate and shows no flag. Lowering the threshold to one is a single SQL constant.

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test && pnpm test:e2e` -- all pass, no tracked file modified afterwards.

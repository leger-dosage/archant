---
title: 'Story 10.6: Merge or dismiss a possible duplicate'
type: 'feature'
created: '2026-09-24'
status: 'done'
baseline_commit: '3cf376929268d5931c318622e2e77a34f05f13b6'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-10-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** When an imported or synced line sits equally near two existing transactions, `ingest` creates it with `transactions.possible_duplicate = true` rather than guess (`pairLines` tie), but nothing shows the flag and nothing resolves it, so the household keeps two copies of one operation (FR52).

**Approach:** Expose the flag, mark flagged rows « Doublon possible » in the list and the sheet, and add two actions: merge the flagged transaction into a candidate it repeats through an entry-source `ledger.absorb` (AD-17), or clear the flag.

## Boundaries & Constraints

**Always:**
- Candidates of a flagged transaction are `pairCandidates`' rule applied to it alone: same account, `kind = 'transaction'`, same `entries.amount`, dated within `MATCH_WINDOW_DAYS` (3) either side, not itself, and carrying no key whose `source` is one of the flagged transaction's key sources. Nearest date first, then oldest `created_at`.
- Merge: the flagged transaction is the absorbed one, the picked candidate the survivor. It is refused unless the absorbed one is flagged and the survivor is one of its candidates, checked in the same database transaction as the write.
- `absorb` gains an entry source. With it, the survivor's own columns stay as they are (date, amount, label, notes, category, merchant, exclusion, `locked_fields`, its own `possible_duplicate`), as an automatic pairing leaves a matched entry. It moves onto the survivor:
  - every `entry_keys` row, by updating `entry_id` (its `import_id` and `connection_id` stay, so reverting that import or disconnecting behaves as for a matched entry);
  - every tagging, as a union; the 20-tag input limit does not apply to a merge;
  - its transfer side, only when the survivor has none; otherwise the absorbed one's transfer is deleted and its other side becomes a standard transaction again;
  - its `rejected_transfers` rows, skipping a pair the survivor already holds.
  Then it deletes the absorbed rows as `deleteTransactionRows` does, and balances recompute from the absorbed transaction's date. Keys moved this way make a later sync or re-import of the absorbed line land in `present` on the survivor.
- Dismiss sets `possible_duplicate = false`, and is idempotent. The flag is only ever set on insert, and a re-sent line key-matches its own row, so it never comes back.
- Routes, both behind the session and the global `csrf()`: `GET /api/transactions/:id/duplicate-candidates`, `POST /api/transactions/:id/merge` with body `{ into: <uuid> }` answering `{ data: <survivor TransactionRecord> }`, `POST /api/transactions/:id/dismiss-duplicate` answering `{ data: <TransactionRecord> }`. An unknown id is `NOT_FOUND`; merging a transaction no longer flagged is the new code `DUPLICATE_RESOLVED` (409); an `into` outside the candidates is `VALIDATION_ERROR` on `into` with code `not_a_candidate`.
- Interface: `TransactionRecord` and `transactionColumns` expose `possibleDuplicate`. The list row shows `TriangleAlertIcon` and « Doublon possible » in `text-warning`, beside the label as `TransferSuggestedFlag` sits. The sheet adds a `DuplicateBlock` section beside `TransferBlock`, with the same marker, « Fusionner avec… » and « Ce n'est pas un doublon ». « Fusionner avec… » opens a dialog listing the candidates (label, account, date, `<Money>`); I select one and press « Fusionner », under a description saying this transaction is deleted and the chosen one kept. After a merge the sheet closes, a toast confirms, and focus goes to the survivor's row. Strings under `transactions.duplicate` in `fr.json`, plus `errors.DUPLICATE_RESOLVED`.
- Tests: `services/ledger.ts` and `domain/**` stay at 100 % branches; no test reaches the network.

**Never:** no copy of the absorbed one's category, merchant, notes or label onto the survivor; no merge across accounts or currencies; no undo of a merge (Sure has none); no pointer column to "the" duplicated transaction; no filter of flagged transactions in the list; no change to how the flag is raised; no fuzzy pending-to-booked suggestions (Sure's `potential_posted_match`); nothing to move for recurring, since `recurring_transactions` points at no entry.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Plain merge | flagged bank line B, candidate file line F, B tagged « vacances », F locked label | F keeps id, label, category, lock; gains B's key and tag; B gone | — |
| Re-sync after merge | B's `entry_reference` sent again | lands in `present` on F, nothing written | — |
| Transfer on B only | B is a transfer side | F becomes that side | — |
| Transfer on both | B and F each in a transfer | F's kept, B's deleted, B's other side standard | — |
| Shared tag | both tagged « vacances » | one tagging | — |
| Balances | B on 09-20, F on 09-22 | balances from 09-20 lose B's amount once | — |
| Dismiss then re-sync | flag cleared, B's line sent again | not flagged | — |
| Not a candidate | `into` in another account, or amount differs | nothing written | 400 `VALIDATION_ERROR`, `into: not_a_candidate` |
| Already resolved | B dismissed or merged in another tab | nothing written | 409 `DUPLICATE_RESOLVED` / 404 `NOT_FOUND`; the sheet refreshes |

</frozen-after-approval>

## Code Map

- `packages/data/schema/transactions.ts:47-49` -- `possible_duplicate` exists (migration `0005`); only its comment changes. No migration.
- `packages/api/src/services/ledger.ts` -- `absorb` (:2084, private) takes a line; add the entry-source variant beside it. `pairCandidates` (:916) holds the candidate rule to share; `groupLines` (:1030) and step 4 (:1404-1446) show that a matched entry gets keys only. `deleteTransactionRows` (:2130), `deleteTransaction` (:2181) and `recomputeBalances` (:304) for the delete and balances. `transferOf` (:174), `rejectedOf` (:2875), `attachKeys` (:989). `transferCandidates` (:3106) is the model for `duplicateCandidates`. `TransactionRecord` (:3232) and `transactionColumns` (:3275) lack the flag.
- `packages/data/schema/{entry-keys,taggings,transfers}.ts` -- `entry_keys` key `(account_id, source, key)` excludes `entry_id`, so an update never collides; `taggings` key `(transaction_id, tag_id)`; `transfers` has a unique index per side.
- `packages/api/src/services/transactions.ts:299-361` -- service wrappers passing `{ origin: "user" }`; add `mergeDuplicate`, `dismissDuplicate`, `listDuplicateCandidates`. `services/transfers.ts:18-31` is a thin example.
- `packages/api/src/routes/transactions.ts:54-56` -- `transfer-candidates` route to mirror; body schema in `src/schemas/transactions.ts`.
- `packages/api/src/lib/errors.ts:7-40` -- add `DUPLICATE_RESOLVED: 409` with its doc comment.
- `packages/web/src/components/TransactionList.tsx:155-167,421-423` -- `TransferSuggestedFlag` to copy; `:464-471` the pending badge.
- `packages/web/src/components/TransactionSheet.tsx` -- `TransferBlock` (:299-412) is the pattern; blocks placed at :597-599; focus return in `onCloseAutoFocus` (:816-828) uses `data-transaction-id`.
- `packages/web/src/components/TransferDialog.tsx` -- candidate list to adapt into `DuplicateDialog.tsx`.
- `packages/web/src/hooks/useTransfers.ts`, `src/lib/query-keys.ts:93` -- add `useDuplicates.ts` and `duplicateCandidates(id)` under `transactions.all`.
- `packages/web/src/components/BankAlerts.tsx:70-71` -- `TriangleAlertIcon` usage; token `text-warning` in `src/styles.css:37`.
- `packages/web/src/locales/fr.json:308-330` -- `transactions.transfer` shape to follow; `errors` at :1066.
- `packages/web/e2e/fixtures.ts:161,237` -- `addTransaction`, `importFile`. Two manual transactions then one OFX line of the same amount and date make a tie; manual entries carry no key, so both are candidates. Pattern in `e2e/transfers.spec.ts:366-384`.
- Sure, for reference: `app/models/transaction.rb:233-342` (merge and dismiss), `app/views/transactions/show.html.erb:9-47`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/services/ledger.spec.ts`, `ledger.ts` -- failing tests for every row of the matrix, then `duplicateCandidates`, the entry-source `absorb`, `mergeDuplicate`, `dismissDuplicate`, and `possibleDuplicate` on `TransactionRecord`; 100 % branches.
- [x] `packages/api/src/lib/errors.ts`, `services/transactions.ts`, `schemas/transactions.ts`, `routes/transactions.ts`, `app.spec.ts` -- the three routes, their envelopes, session and `csrf()` guards, `DUPLICATE_RESOLVED`.
- [x] `packages/data/schema/transactions.ts` -- comment now names the merge and dismiss actions.
- [x] `packages/web/src/components/DuplicateFlag.tsx`, `TransactionList.tsx` -- the row marker.
- [x] `packages/web/src/hooks/useDuplicates.ts`, `lib/query-keys.ts`, `components/DuplicateDialog.tsx`, `TransactionSheet.tsx`, `locales/fr.json` -- sheet block, dialog, toasts, focus after merge.
- [x] `packages/web/e2e/duplicates.spec.ts` -- a tie shows « Doublon possible » in the row and the sheet; « Fusionner avec… » leaves one row with the survivor's label and the imported tag; « Ce n'est pas un doublon » removes the marker, and re-importing the same file adds nothing.

**Acceptance Criteria:**
- Given a transaction flagged by a file import or a sync, when the list or its sheet shows it, then it carries a warning icon and « Doublon possible », never colour alone.
- Given a flagged transaction, when I choose « Fusionner avec… » and pick a candidate, then that candidate keeps its id and hand-set fields, gains the flagged one's keys, tags and transfer, and the flagged one is deleted.
- Given a flagged transaction, when I choose « Ce n'est pas un doublon », then the flag is cleared and a later sync or re-import never raises it again.

## Implementation Notes

- `duplicateCandidates` answers an empty list for a transaction no longer flagged, in step with the merge refusing it.
- `into` is `z.string().min(1)`, as `counterpartId` is: no schema of this repo checks an id's format, so an unknown id is `not_a_candidate`.
- The merge and dismiss hooks invalidate without awaiting: awaiting refetched the merged row's candidates, whose 404 retries held the mutation pending for seconds.
- On `NOT_FOUND` the sheet closes, the row being gone; on `DUPLICATE_RESOLVED` only the block hides. After « Ce n'est pas un doublon » focus goes to the sheet's first control, the clicked button being gone.

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Evidence / route |
|---|---|---|
| A `NOT_FOUND` on merge or dismiss leaves the sheet open on a deleted transaction (blind, edge) | medium | `failed` only hides the block; the next save answers 404. Patch: close the sheet. |
| The block's `useState` ignores a refetched record cleared elsewhere (blind) | low | A direct correction: derive from `transaction.possibleDuplicate`. Patch. |
| Dialog description ambiguous, « reçoit ses étiquettes » (blind) | low | « ses » reads as the chosen one's. Patch: reworded. |
| `origin` accepted and never read by `mergeDuplicate`, `dismissDuplicate` (blind, verification) | low | A misleading signature; deleting it is direct. Patch. |
| Transfer move untested on the inflow side (verification) | medium | Only the outflow update is exercised; the inflow one could go unnoticed. Patch: test on both signs. |
| A survivor past 20 tags cannot be saved from the sheet (blind, edge) | low | True: the form checks `max(20)` on the whole list. Needs two transactions with over 20 distinct tags between them; fixing adds a cap or a schema branch. Rejected. |
| A pending flagged line merged comes back once booked (blind) | false | A pending line never pairs by amount and date (10.4), so it is never flagged. |
| « Aucune opération… » shown for a transaction no longer flagged; « 3 jours » hard-coded (blind) | low | Only after a resolution in another tab, where merge then refuses; `transfer.noCandidate` hard-codes its window the same way. Rejected. |
| Rejected pair (absorbed, survivor) becomes a self-pair (blind) | low | Survivor and absorbed share account and amount, so both sit on one side and no rejected pair links them unless amounts were edited after; a guard adds a branch. Rejected. |
| Focus lost when the survivor's row is not on the page (blind, edge) | low | Radix's default applies; the row is usually visible after a merge from the list. Rejected. |
| UI error paths untested (blind, verification) | low | Playwright is the only UI test layer; a two-tab scenario for a secondary path. Deferred. |
| Spec status and sprint status disagree; empty spec sections (blind) | false | The workflow syncs the sprint status and fills these sections at its end. |
| Rejected pair moved while the survivor is in a transfer with the same counterpart (edge) | low | Needs a user-made transfer and rejection on two rows of one tie; guarding adds a query. Rejected. |
| Transfer moved onto a survivor holding a rejected pair with its counterpart (edge) | low | Same rarity; rejected. |
| Survivor deleted between the merge's commit and `found` (edge) | low | A race within one request; the toast then says not found and a refresh shows the truth. Rejected. |
| `into` validated as a non-empty string, not a UUID (edge) | low | No schema of this repo checks id format (`counterpartId` alike); either way the answer is `VALIDATION_ERROR`. Rejected. |

## Design Notes

The survivor keeps its own columns because a merge is the hand-made version of the pairing the tie prevented: a matched entry gets the line's keys and nothing else. The AC's "keeps the fields I set by hand" then holds for every field, not only locked ones. Sure's merge copies the category and date from the deleted side; its case is pending into booked, which 10.4 already covers here.

The story's "recurring link" has nothing to move: recurring patterns are keyed by account, merchant or label, and amount, and the next detection recounts them.

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck` -- expected: clean.
- `pnpm test` -- expected: green, 100 % branches on `connectors/**`, `domain/**`, `services/ledger.ts`.
- `pnpm test:e2e` -- expected: green, no request leaves loopback.

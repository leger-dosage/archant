---
title: "Story 29.7: Suggest and merge pending duplicates"
type: 'feature'
created: '2026-10-17'
status: 'done'
baseline_commit: '5f25b0174db37e62491def304cde472463339307'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-29-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Sure (at `00dd977fb`) suggests, after saving a new booked line that claimed no pending entry, a pending entry of the same source and currency dated 0 to 3 days before it whose amount is close but not equal (`find_pending_transaction_fuzzy`, then `find_pending_transaction_low_confidence`), stores it on the pending entry (`potential_posted_match`), shows « Doublon ? » or « Vérifier » on its row and « Doublon possible détecté » in its sheet, merges it on « Oui, fusionnez-les » (`merge_with_duplicate!`), dismisses it for good on « Non, gardez les deux », and lets « Ouvrir la fusion » merge any pending entry into a booked line of its account picked ten at a time (`PendingDuplicateMergesController`). Archant has none of it: a pending line booked at another amount, a tip or an adjusted card payment, stays listed beside its booked line.

**Approach:** After a sync inserts its booked lines, the ledger stores Sure's suggestion on the pending entry in three new `transactions` columns; the transaction sheet and list show it, and two routes merge or dismiss it, a third lists the merge candidates. The merge reuses `absorbEntry`, then applies Sure's inheritance and lock.

## Boundaries & Constraints

**Always:**
- Candidates: pending entries of the account carrying a key of the syncing connection (Sure's `where(source:)`), same currency, dated `d` with `0 ≤ line.date − d ≤ 3`. Amounts compare in absolute minor units, as Sure's `ABS`: medium band `|p| × 13 ≥ |b| × 10` and `|p| ≤ |b|`; low band `|p| × 2 ≥ |b|` and `|p| × 100 ≤ |b| × 77`.
- Medium: among the band, exactly one sharing the line's bank merchant wins; else exactly one sharing its first three label words wins. Low, tried only when medium finds none: the line must have a merchant and words, and exactly one candidate shares both. Words: lower-cased, every character but `a-z`, `0-9` and ASCII whitespace removed, split on ASCII whitespace, first three joined, as Sure's regex.
- Only a sync's new booked lines (created or tie-flagged) suggest, after step 4, in statement order, with the bank's merchant before rules. A suggestion is stored only on an entry holding none and never dismissed (Sure keeps the first one found).
- Columns, migration `0087`: `posted_match_id` (references `entries.id`, on delete set null), `posted_match_confidence` (`medium` | `low`), `posted_match_dismissed` (boolean, default false). `TransactionRecord.postedMatch` is `{ id, confidence }` while pending, set and not dismissed, else `null`. The export leaves the three columns out, as Sure's exporter writes no `extra`.
- Merge (`POST /api/transactions/:id/merge-pending`, `{ into }`, answers the survivor): the pending entry must still be pending (`DUPLICATE_RESOLVED` otherwise), `into` one of its candidates (`VALIDATION_ERROR` `into: not_a_candidate`), unknown id `NOT_FOUND`, split refused as the tie merge. Inside one write: `absorbEntry` moves keys, tags, attachments, recurring payments, transfer and rejected pairs and deletes the pending entry; then, unless the survivor is excluded, the survivor takes the pending category with its origin unless `category` is locked, and the pending date unless `date` is locked; the pending notes are appended after a blank line when they differ (taken alone when the survivor has none); `date` and `amount` are locked as a user write; balances recompute from the earliest date touched.
- Candidates (`GET /api/transactions/:id/pending-merge-candidates?offset=n`, `{ candidates, hasMore }`): booked transactions of the same account and currency, not itself, no split part, latest date then latest created first, ten per page; none for an entry no longer pending. `GET /api/transactions/:id/posted-match` answers the suggested line as a candidate, or `null`.
- Dismiss (`POST /api/transactions/:id/dismiss-posted-match`): sets `posted_match_dismissed`, idempotent, `NOT_FOUND` for an unknown id.
- Interface, Sure's words with « opération » where Archant says it: row badge « Doublon ? » (warning, tooltip « Cette opération peut être un doublon d'une autre opération ») or « Vérifier » (neutral, tooltip « Écart de montant important — vérification recommandée pour vérifier s'il s'agit d'un doublon »); sheet alert « Doublon possible détecté » with the booked line and, for an administrator, « Oui, fusionnez-les » and « Non, gardez les deux »; on every pending entry, for an administrator, « Doublon d'une opération validée ? » with « Ouvrir la fusion », whose dialog lists ten candidates with « ← 10 précédentes », « 10 suivantes → » and « Fusionner les opérations ».
- AD-17 and `docs/sure-parity.md` « Possible duplicates » change with this story.

**Never:** no change to the tie flag of Story 10.6 or its routes; no suggestion from a file import, a manual line or a pending line; no automatic merge; no category lock that would stop rules, since Sure's `user_modified` stops syncs only; no new dependency.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Tip | pending −20,00 € day D, booked −23,00 € D+1, same merchant | medium suggestion on the pending | none |
| 3 days | pending D−3 | suggested | none |
| 4 days / after | pending D−4 or D+1 | none | none |
| Two by merchant | two pending of the merchant in band | label words decide, else none | none |
| Large gap | pending −12,00 €, booked −20,00 €, merchant and words | low suggestion | none |
| Large gap, label only | merchant differs | none | none |
| Under half | pending −9,00 €, booked −20,00 € | none | none |
| Dismissed | dismissed, then a new booked line matches | no new suggestion | none |
| Merge | pending tagged, attachment, notes, category; booked dated later | pending gone; booked keeps label and merchant, takes category and date, gains tags, attachment, notes; `date`, `amount` locked | none |
| Locked date | booked date locked | date kept | none |
| Re-sync | pending line sent again | lands on the survivor, nothing created | none |
| Already booked | merge after the entry was booked | nothing written | 409 `DUPLICATE_RESOLVED` |
| Not a candidate | `into` in another account or pending | nothing written | 400 `VALIDATION_ERROR` |
| Pages | 11 booked lines | 10 then 1, `hasMore` true then false | none |

</frozen-after-approval>

## Code Map

- `packages/api/src/domain/pending.ts` -- add `suggestPostedMatch(line, candidates)` and the word helper beside `absorbPending`; 100 % branches.
- `packages/api/src/services/ledger/ingest.ts` -- after step 4's inserts, when `keyTarget.connectionId` is set, read candidates and store suggestions for non-pending `rows`; merchant from `merchantIds`.
- `packages/api/src/services/ledger/pending.ts` -- a query for suggestion candidates beside `pendingOfConnection`.
- `packages/api/src/services/ledger/duplicates.ts` -- reuse `absorbEntry`; add `pendingMergeCandidates`, `postedMatchOf`, `mergePending`, `dismissPostedMatch`; `refuseSplit`, `invalidField`, `recomputeBalances`, `lockedBy` (`shared.ts`).
- `packages/api/src/services/ledger/queries.ts` -- `postedMatch` on `TransactionRecord` and `transactionColumns`.
- `packages/api/src/services/transactions.ts`, `routes/transactions.ts`, `schemas/transactions.ts` -- wrappers and the four routes beside `/:id/merge`.
- `packages/api/src/services/ledger/export.ts` -- `LEFT_OUT.transactions` for the three columns.
- `packages/data/schema/transactions.ts`, `packages/data/drizzle/0087_*.sql`, `packages/data/migrate.spec.ts` -- columns, check, migration test.
- `packages/app/src/hooks/useDuplicates.ts`, `lib/query-keys.ts` -- queries and mutations.
- `packages/app/src/components/PendingMergeDialog.tsx` (new), `TransactionLinks.tsx` (`PostedMatchBlock`, `PendingMergeBlock`), `TransactionForm.tsx`, `TransactionList.tsx`, `StatusBadge.tsx`, `locales/fr.json`.
- `packages/app/e2e/fake-enable-banking.ts`, `e2e/duplicates.spec.ts` -- a bank listing a pending line, then booking it higher; Playwright merges the suggestion.
- Docs: `docs/architecture.md` AD-17, `docs/sure-parity.md`.
- Sure, read-only, at `00dd977fb`: `app/models/account/provider_import_adapter.rb` (lines 313-363, 828-1009), `app/models/transaction.rb` (`merge_with_duplicate!`, `pending_duplicate_candidates`), `app/controllers/pending_duplicate_merges_controller.rb`, `app/views/transactions/show.html.erb`, `_transaction.html.erb`, `app/views/pending_duplicate_merges/new.html.erb`, `config/locales/views/{transactions,pending_duplicate_merges}/fr.yml`.

## Tasks & Acceptance

**Execution:**
- [x] Vitest first, failing: `suggestPostedMatch` bands, bounds, ambiguity, words; ingest storing medium and low suggestions, first kept, dismissed never replaced, nothing from an import; merge, refusals, re-sync, pages, dismissal; routes; migration.
- [x] Schema, migration, domain, ledger, services, routes, export.
- [x] Interface badges, sheet blocks, dialog, strings.
- [x] Playwright: a sync suggests, « Oui, fusionnez-les » leaves one line.
- [x] AD-17, parity row.

**Acceptance Criteria:**
- Given a sync's new booked line and a pending entry in a band, when the rules above single it out, then its row and sheet show the suggestion.
- Given a suggestion, when the administrator merges or dismisses it, then the pending entry goes as described, or the suggestion never shows again.
- Given a pending entry, when « Ouvrir la fusion » opens, then booked lines of its account show ten at a time and one can be merged.
- Given the finished story, when `pnpm test` and `pnpm test:e2e` run, then both pass with no request reaching Enable Banking.

### Review Findings

Second pass, `bmad-code-review` (four layers) over the committed branch.

- [x] [Review][Patch] Joined notes could pass the 2 000-character limit, so every later save of the survivor from the sheet failed [packages/api/src/services/ledger/duplicates.ts]
- [x] [Review][Patch] « Non, gardez les deux » sent to an entry without a suggestion blocked every later one; Sure does nothing then [packages/api/src/services/ledger/duplicates.ts]
- [x] [Review][Patch] `absorbEntry`'s repoint could make an entry suggest itself [packages/api/src/services/ledger/duplicates.ts]
- [x] [Review][Patch] The `offset` schema comment claimed Sure's clamp while the schema refuses [packages/api/src/schemas/transactions.ts]
- [x] [Review][Patch] The export's reason repeated three times [packages/api/src/services/ledger/export.ts]
- [x] [Review][Patch] No test of `TRANSACTION_SPLIT` on `mergePending`, nor of statement order between two fitting booked lines [packages/api/src/services/ledger/duplicates.spec.ts]
- [x] [Review][Patch] The Playwright absence of the « Cette ressource n'existe pas. » toast was asserted before the refetch [packages/app/e2e/duplicates.spec.ts]
- [x] [Review][Patch] `PendingMergeBlock`'s JSDoc said « transaction » [packages/app/src/components/TransactionLinks.tsx]
- [x] [Review][Patch] The parity row said Parity without naming the differences decided (per-field locks, the connection's entries, a suggestion after deletion, one read after step 4, a refused negative offset) [docs/sure-parity.md]

Rejected:
- `false` `usePendingMergeFailure` shows the generic toast after `NOT_FOUND`: the tie block does the same, and here the user's own click learns the row is gone.
- `false` The fake bank lists the tip on both pages: `page-2` returns before the tip lines.
- `false` Spec `done` while sprint status read `review`: both move to `done` with this review.
- `low` The row badge stays once the suggested line is split, while the sheet shows no alert: clearing it needs the split service to touch suggestions, for a rare sequence.
- `low` The suggestion block reuses the dialog's « Opération non valide sélectionnée pour la fusion » on `VALIDATION_ERROR`: `postedMatchOf` already hides a line the merge would refuse.
- `low` A split target answers `TRANSACTION_SPLIT` before an already booked entry's `DUPLICATE_RESOLVED`: the tie merge orders its refusals the same way.
- `low` The dialog resets its page in an effect, one frame late on reopening: `DuplicateDialog` does the same.
- `low` No component test of the dialog's pagination: Playwright drives the dialog, and its logic is a page offset.

## Implementation Notes

Decisions taken alone, each aligned with Sure at `00dd977fb` or forced by Archant's model:

- Migration `0087_posted_match` rebuilds `transactions`, as drizzle-kit does for a new check constraint; its `INSERT` is written by hand so existing rows start with no suggestion. It adds the index `transactions_posted_match`: `on delete set null` would otherwise scan the table for every deleted entry.
- An entry "holds" a suggestion while `posted_match_id` is set. Once its booked line is deleted (set null) and it was never dismissed, a later booked line may suggest again; the confidence column is simply overwritten then. Sure keeps a dangling id and never suggests again; the spec already departs from that by setting null.
- Candidates are read once, after step 4, so a pending line created by the same statement is a candidate for a booked line listed before it, where Sure's line-by-line processing would only see it after. Only a first sync listing both lines at once can tell, and the outcome is a suggestion, never a merge.
- Entries already holding or dismissed still count among a line's candidates, so two fit entries stay ambiguous, as Sure's finders ignore `potential_posted_match` and only `store_duplicate_suggestion` skips the write.
- `labelWords` lower-cases with `toLowerCase`, Ruby's `downcase` being Unicode-aware too, then keeps `a-z`, `0-9` and ASCII whitespace, as Sure's regex.
- The merge reads the survivor's `excluded` as Sure's `protected_from_sync?`, field locks standing for `user_modified?` per field, as the spec says. Notes: a pending note equal to the survivor's is not repeated; blank notes are stored as `null` by every writer, so only `null` counts as none.
- `postedMatchOf` answers `NOT_FOUND` for an unknown id, and `null` when the suggested line is no merge candidate any more, split since for instance (AD-20), so the sheet never offers a merge the ledger refuses. `absorbEntry` repoints `posted_match_id` from the absorbed line to the survivor, so a tie merge of the suggested booked line keeps the suggestion that `on delete set null` would drop.
- The merge cuts the joined notes to `NOTES_MAX_LENGTH`, the survivor's own text first, so a later save from the sheet still validates. `dismissPostedMatch` writes only on an entry holding a suggestion, as Sure's `dismiss_duplicate_suggestion!` returns without one, so a dismissal never blocks a suggestion still to come.
- A merge refused with `NOT_FOUND` closes the sheet and still shows the error toast, as the tie block `DuplicateBlock` does: the row went elsewhere, and the user is told.
- `GET /:id/pending-merge-candidates` refuses a negative `offset` with `VALIDATION_ERROR`, where Sure clamps it to 0; the interface never sends one.
- The posted-match and candidates queries carry `meta.notFoundInline`: after a merge, their refetch finds the pending row gone, and the global « Cette ressource n'existe pas. » toast showed on top of « Opérations fusionnées avec succès » during visual QA.
- Interface placement follows Sure's `show.html.erb`: the « Doublon possible détecté » alert at the top of the sheet, « Doublon d'une opération validée ? » with the other link blocks; the dialog shows the pending line's account name read from the accounts list, as Sure's.
- Toasts use Sure's flash keys with « opération »: « Opérations fusionnées avec succès », « Conservées comme opérations distinctes », and the manual merge's « Opération en attente fusionnée avec l'opération validée » (Sure says « publiée », replaced by « validée » for one word, one meaning).
- The fake Enable Banking gains `TIP_BANK` (« Banque Pourboire »): its current account lists a pending -20,00 € yesterday on the first statement, then the bill booked at -23,00 € today from the second on. The Playwright test ages `last_synced_at` to pass the hour the « Synchroniser » button still waits (Story 29.9 removes it).

## Spec Change Log

## Review Triage Log

First pass, `bmad-build` step 4: Blind Hunter, Edge Case Hunter, Verification Gap.

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | AD-17, parity row and doc comments say « within 30 % below the line » for a band that keeps the booked line at most 30 % above the pending amount (blind) | low | patch | `|p| × 13 ≥ |b| × 10` puts the pending amount at most about 23 % below; reworded everywhere. |
| 2 | `postedMatchOf` and the sheet offer a merge into a suggested line split since, which the ledger refuses (blind, edge) | low | patch | `postedMatchOf` now applies `pendingMergeCondition`; the block hides on `null`. The row badge stays, a rare case left as is. |
| 3 | A tie merge of the suggested booked line drops the suggestion through `on delete set null` (blind, edge) | low | patch | `absorbEntry` repoints `posted_match_id` to the survivor, as it moves every other pointer. |
| 4 | « Fusionner les opérations » can merge a line picked on another page; the range text describes the next page while the previous one shows; an empty page past the first hides « ← 10 précédentes » (blind, edge) | low | patch | The pick resets per page and must be shown; range and links read the shown page's offset; the links stay on an empty page. |
| 5 | No test that a pending entry booked by a later sync drops its suggestion (verification) | medium | patch | Route test asserts `postedMatch: null` and `{ data: null }` after the booking sync. |
| 6 | No test that an entry already holding a suggestion keeps two fit entries ambiguous (verification) | medium | patch | Test added in `duplicates.spec.ts`. |
| 7 | The merged category's origin is never asserted (verification) | low | patch | Asserted beside `categoryId`. |
| 8 | Statement order and tie-flagged lines among the suggesting lines untested (verification) | low | defer | Deferred at first; the second review showed two plain booked lines suffice, and the test landed then. |
| 9 | Currency filters of the suggestion and the merge untested (verification) | false | reject | An account holds only its currency: `rejectionFor` refuses any other line (`CURRENCY_MISMATCH`, AD-6), so no test can reach a second currency on one account; the filters mirror Sure's. |
| 10 | A confidence left behind once `posted_match_id` is set null (blind, edge) | low | reject | Every reader checks the id first; a check tying both columns would make the FK's `set null` fail. |
| 11 | Another pending entry still suggests merging into a booked line that absorbed one already (edge) | false | reject | Sure allows several merges into one posted line (`manual_merge` array). |
| 12 | Pending split entries among the suggestion candidates (edge) | false | reject | A pending entry cannot be split (`NOT_SPLITTABLE`). |
| 13 | Migration rebuilds `transactions` where `ADD COLUMN` would do (blind) | low | reject | drizzle-kit's output for a new check, as migration 0084; tested on copied rows. |
| 14 | No route test of a viewer's refusal or a fractional `offset` (blind) | low | reject | `viewerReadOnly` refuses every POST globally and has its own tests; zod's `int()` is library behaviour. |
| 15 | `syncedHoursAgo` repeats `age` from `bank-connections.spec.ts` (blind) | low | reject | A four-line test helper; Story 29.9 removes the hour it works around. |
| 16 | The pending entry's stored merchant may come from a rule, the line's from the bank (blind) | false | reject | Sure compares the same: `transactions.merchant_id` against the provider's `merchant&.id`. |
| 17 | Playwright covers neither dismissal, a low suggestion nor a refused merge (blind) | low | reject | The story asks Playwright for a merged suggestion; Vitest covers the rest. |

## Design Notes

Assumptions taken alone, each settled by Sure. Bands and words follow Sure to the character, in integer minor units: `1/1.3` becomes `× 13 ≥ × 10`, `0.77` becomes `× 100 ≤ × 77`. The suggestion uses the bank's merchant, Sure's `merchant&.id`, never a rule's. A suggestion pointing at a deleted booked line goes with it (set null) where Sure keeps a dangling id; a dismissal stays. The suggestion shows only while the entry is pending: Sure's flag would outlive a later claim. The merge locks `date` and `amount` only: Archant's lock stops rules too, and Sure's `mark_user_modified!` stops syncs alone, which never rewrite a booked line in Archant anyway. Notes, tags and attachments move, a fix over Sure's loss (we-promise/sure#4220). A non-pending entry answers `DUPLICATE_RESOLVED`, Sure's `pending_only`. Split parts stay out of the candidates, since the ledger refuses to merge them (AD-20). Words are « opération » and « validée », Archant's own, around Sure's sentences.

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test && pnpm test:e2e` -- all green, no tracked file changed after.

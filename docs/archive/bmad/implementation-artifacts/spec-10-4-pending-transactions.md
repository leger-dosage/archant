---
title: 'Story 10.4: Pending transactions'
type: 'feature'
created: '2026-09-24'
status: 'done'
baseline_commit: 'ef0d94e375661594af1acddb9ce81a60ca51a6fb'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-10-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A card payment the bank has not booked yet never reaches Archant: the Enable Banking connector drops every `PDNG` line (`client.ts:131`), so a linked account lags the bank by days and cannot show what was just spent (FR51).

**Approach:** Keep `PDNG` lines as pending transactions, count them in balances and leave them out of cash flow (AD-8, AD-9), reconcile each booked line with its pending entry in step 3 of `ingest` through a new `ledger.absorb` that keeps the entry's id (AD-17), and delete a pending entry after two consecutive syncs that no longer return it.

## Boundaries & Constraints

**Always:**
- Storage: `transactions.pending` (boolean, default false) and `transactions.pending_missed_syncs` (integer, default 0). Both sit on `transactions`, not `entries` as AD-17 words it, because AD-8 keeps transaction-only columns there; the spine is corrected in the same change. `NormalizedTransaction` gains `pending: boolean`; every file parser sets `false`; the connector maps `PDNG` to `true`, `BOOK` to `false`, and still drops every other status.
- Balances: pending entries count (AD-8). The bank's `ITBD`/`CLBD` is a booked balance, so `recomputeBackward` adds the pending entries dated on or before the anchor's date to the anchor (AD-18 "pending applied on top"); pending entries after it go forward as any movement. The stored `current_anchor` stays the bank's figure.
- Cash flow: `countsInCashFlow` returns false for pending, and `cashFlowByCategory` adds `pending = false`, kept in step by the existing parity test. The list's direction filter is unchanged, as for excluded transactions.
- Step 3 runs inside `groupLines`, between key matching and `pairLines`, only when the source carries a `connectionId`:
  - A booked line whose key hits a pending entry is absorbed by it, amount included.
  - A booked line with no key hit is absorbed by a pending entry of the same account carrying a key of the same connection, with the same amount, dated within 5 days either side; nearest date first, then oldest `created_at`. One pending entry absorbs at most one line. Lines left over go to `pairLines` as today.
  - A pending line whose key hits a pending entry refreshes it (date, amount, label, notes). A pending line whose key hits a booked entry changes nothing.
  - A pending line never pairs with an entry by amount and date: it is created or key-matched.
- `ledger.absorb(tx, survivorId, line, keyTarget, origin)` updates the survivor in place: date, amount, label and notes from the line unless locked (`changeOf`), `pending` from the line, `pending_missed_syncs` to 0, and attaches the line's keys. The pending entry's old keys stay, so the bank re-sending the old pending line finds a booked entry and changes nothing. Category, merchant, tags, transfer and exclusion are untouched. Rules do not run again on an absorbed entry. Balances recompute from the earlier of the old and new dates.
- Missed syncs, in the same `ingest` transaction, after step 4: every pending entry of the account carrying a key of the connection that no line of the statement matched gets `pending_missed_syncs + 1`; one reaching 2 is deleted as `deleteTransaction` deletes (keys, taggings, transfer sides), and balances recompute. A matched one resets to 0. A failed account rolls back, so a failed sync never counts as a miss.
- Window: `windowStart` becomes the earlier of today's rule and the date of the account's oldest pending entry, so a pending entry is always inside the requested range and its absence means something.
- Interface: `transactionColumns` exposes `pending`; `listTransactions` orders by `date desc, pending desc, created_at desc, id desc`. A pending row shows `<Money muted>` and an outline `Badge` « En attente » next to the amount, never colour alone. Strings in `fr.json` under `transactions`.
- Tests: `domain/**`, `connectors/**` and `services/ledger.ts` stay at 100 % branches. No test reaches the network.

**Never:** no merge or dismiss of a possible duplicate, no « Doublon possible » marker, no entry-to-entry `absorb` (10.6 extends `absorb` with an entry source); no Sure-style fuzzy suggestions or `auto_claimed_pending_ids`; no pending filter in the list; no pending exclusion from rules, transfer matching or recurring detection (Sure has none); no change to file imports beyond `pending: false`; nothing about disconnection (10.5).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| New pending | `PDNG` −12.00 today, `ITBD` 1000.00 | pending entry; balance today 988.00; cash flow unchanged | — |
| Same reference | pending `ref-1` −12.00, then `BOOK` `ref-1` −12.50 | same id, −12.50, not pending, tags and category kept | — |
| No reference | pending −3.20 on 09-20, then `BOOK` −3.20 on 09-23, new label | same id, booked date and label | — |
| Locked field | user renamed the pending entry, then booked arrives | label kept, amount and date updated | — |
| Outside 5 days | pending −3.20 on 09-10, `BOOK` −3.20 on 09-20 | booked created; pending counts its miss | — |
| Two candidates | two pending −3.20 on 09-20 and 09-22, `BOOK` −3.20 on 09-22 | the 09-22 entry absorbs it | — |
| Missed twice | pending absent from two successful syncs | deleted, balances recomputed | — |
| Missed once, back | absent once, returned next sync | kept, counter 0 | — |
| Failed account | account's sync fails | counters unchanged | per 10.3 |
| Old pending | pending dated 20 days ago, last sync yesterday | `date_from` is its date | — |

</frozen-after-approval>

## Code Map

- `packages/data/schema/transactions.ts:34-99` -- add `pending`, `pending_missed_syncs`; migration `0029_*` through `pnpm --filter @archant/data generate`. Check drizzle-kit's table rebuild copies every column (it mishandled `0028`).
- `packages/api/src/domain/statement.ts:13` -- `pending: boolean` on `NormalizedTransaction`; update the doc comment at :9. File parsers `connectors/{ofx,csv,qif}/` set `false`.
- `packages/api/src/connectors/enable-banking/client.ts:131` -- map `PDNG`; `client.spec.ts:521`, `:585` assert the drop and must flip. `bank-connector.ts:81` comment.
- `packages/api/src/services/ledger.ts` -- `groupLines` (:791) gains step 3 and a `absorbed` group; `ingest` (:964) comment at :1108 becomes the step; `entriesByKey` must return whether the hit entry is pending; `pairCandidates` (:694) already excludes same-source entries, reuse as is; `attachKeys` (:760); `changeOf` (:1570) for locks; `deleteTransaction` (:1769) shows the delete order for missed entries; `recomputeBackward` (:214) adds pending on top of the anchor; `transactionColumns` (:2870), `listTransactions` order (:3243), `cashFlowByCategory` (:3322). `Groups` and the preview digest gain the absorbed lines only if `dryRun` needs them (files never have them).
- `packages/api/src/domain/cash-flow.ts:48` -- `countsInCashFlow` and `CountedTransaction` gain `pending`.
- `packages/api/src/services/sync.ts:45` -- `windowStart` takes the oldest pending date; `runSync` (:104) reads it per account.
- `packages/web/src/components/TransactionList.tsx:408-470` -- badge and muted amount beside `ExcludedMarker`; `components/ui/badge.tsx` `outline`; `locales/fr.json` `transactions.pending`.
- `packages/web/e2e/fake-enable-banking.ts:49`, `:115` -- the pending line « Boulangerie en attente » −3.20 today already exists; its comment says it never shows.
- `packages/web/e2e/bank-connections.spec.ts:310`, `:318` -- the sidebar expects `1 234,56 €` and the pending row absent; both change to `1 231,36 €` and a row with « En attente ».
- Sure, for reference only: `app/models/account/provider_import_adapter.rb:103-155`, `:781-811`; `app/models/enable_banking_item/importer.rb:403-526`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/data/migrate.spec.ts`, `schema/transactions.ts`, `drizzle/0029_*` -- failing test for the two columns and their defaults, keys and rows surviving the rebuild; then the migration.
- [x] `packages/api/src/connectors/enable-banking/client.spec.ts`, `client.ts`, `domain/statement.ts`, file parsers -- `PDNG` kept as pending, `INFO` still dropped, files `pending: false`.
- [x] `packages/api/src/domain/cash-flow.spec.ts`, `cash-flow.ts` -- pending never counts.
- [x] `packages/api/src/services/ledger.spec.ts`, `ledger.ts` -- the matrix through `ingest` with a connection source; `absorb` keeps id, taggings, category, transfer and locked fields; pending on top of the anchor for dates before, on and after it; missed-sync counter and delete; `cashFlowByCategory` parity; list order; 100 % branches.
- [x] `packages/api/src/services/sync.spec.ts`, `sync.ts` -- `windowStart` with an old pending entry; two syncs without the line delete it; a failed account keeps its counters.
- [x] `packages/web/src/components/TransactionList.tsx`, `locales/fr.json` -- marker and muted amount.
- [x] `packages/web/e2e/fake-enable-banking.ts`, `bank-connections.spec.ts` -- after linking, the pending row shows « En attente » at the top of today and the sidebar shows the balance with it.
- [x] `_bmad-output/planning-artifacts/architecture/architecture-archant-2026-09-21/ARCHITECTURE-SPINE.md` -- AD-17 names `transactions.pending_missed_syncs`.

**Acceptance Criteria:**
- Given pending lines from the bank, when they sync, then they are stored as pending, shown with « En attente », counted in the account balance and left out of monthly cash flow.
- Given a pending entry, when its booked version arrives by the same `entry_reference` or by the same amount within 5 days, then the entry keeps its id, tags, category and locked fields and is no longer pending.
- Given a pending entry absent from two consecutive successful syncs and not booked, when sync runs, then it is deleted.

## Implementation Notes

- The amount-and-date match is a pure function, `absorbPending` in `domain/pending.ts`, with `PENDING_WINDOW_DAYS` and `MAX_MISSED_SYNCS`.
- `deleteTransactionRows` is extracted from `deleteTransaction` so missed entries go the same way, keys, transfer sides and taggings first.
- `attachKeys` takes `keepExisting`, passed by `absorb` only: an absorbed line brings the key that found its entry. Every other caller still throws on a conflicting key.
- `oldestPendingDate(deps, accountId, connectionId)` widens the window, scoped to the connection as `pendingOfConnection` is.
- `absorb` stays private to the ledger; Story 10.6 exports it and adds an entry source. The ingest result does not count absorbed lines.
- drizzle-kit wrote `0029` as two `ALTER TABLE ... ADD`, with no table rebuild.
- The e2e checking account now ends on `1 231,36 €`: the bank's `1 234,56 €` with the pending −3,20 € on top.

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Evidence / route |
|---|---|---|
| A pending line and a booked line of the same amount in one statement: the booked line cannot absorb the entry its pending line refreshed (blind) | low | Deliberate: nothing tells the booked version of E from a second purchase of the same amount; merging would lose a purchase. The entry goes after two misses once the bank drops its pending line. Deferred with the lingering-pending entry. |
| An unreadable pending line counts as a miss (blind, edge) | low | The line was readable when the entry was created; the same line turning unreadable twice in a row is unlikely, and skipping miss counts on any rejection would pin stale entries. Rejected. |
| Two misses can fall an hour apart (blind) | low | The cron runs daily; two button presses an hour apart inside the bank's gap between dropping a pending line and listing its booked one is rare. A time condition changes the intent's « two consecutive syncs ». Deferred. |
| `attachKeys` swallows every key conflict (blind, edge, verification) | medium | Created and matched rows used to throw on a conflicting key; now it is dropped and the entry loses a key. Patch: skip existing keys on the `absorb` path only. |
| An absorption during a sync without a bank balance loses the amount (blind) | low | Needs `fetchBalance` to return nothing and a booked date on or before the old anchor; the next sync with a balance rewrites the anchor. Rejected. |
| Rules never see the booked label (blind) | false | The intent states that rules do not run again on an absorbed entry. |
| Absorbing a changed amount leaves a transfer unbalanced (blind, edge) | low | A pending card line matched as a transfer that then changes amount under the same reference is rare; unlinking adds a branch. Rejected. |
| `ingest` does not report absorbed lines (blind) | low | Sync logs a count only; cosmetic. Rejected. |
| The opening-day move ignores absorbed lines (blind) | low | A bank-linked account ignores the opening anchor's amount (AD-8); an absorption moves a date by five days at most. Rejected. |
| `created` sorted with `Number(ref)` (blind) | false | `ref` is `String(index)` for every keyed line (`ledger.ts`, `ingest`). |
| `oldestPendingDate` spans every connection (blind, edge) | medium | A pending entry whose connection is deleted keeps its date in the window forever. Patch: scope it to the connection. The orphaned entry itself belongs to disconnection, deferred to 10.5. |
| Missing tests: `claimed` filter, rules not re-run, locked amount (blind, verification) | medium | Removing the filter or re-running rules keeps every test green. Patch: three tests. |
| Spec status and task boxes disagree (blind) | false | The workflow ticks tasks and syncs the sprint status after review. |
| Drizzle snapshot left out of the reviewed diff (blind) | false | Left out on purpose as generated; `migrate.spec.ts` checks the migration against the schema. |
| A `PDNG` line with a future `value_date` is dated in the future (edge) | maybe-false | Settled by a real bank's pending payload; the fixtures carry `transaction_date` only. AD-18 fixes the date order. Deferred, unverified low-to-medium. |
| Pending entries on a relinked or deleted connection are orphaned (edge) | medium | Their keys lose `connection_id`, so no sync absorbs or deletes them, and they stay in the balance. Disconnection is Story 10.5's. Deferred. |
| Window grows without bound (edge) | low | With the window scoped to the connection, an entry the bank no longer lists goes after two misses; one it still lists is genuinely pending. Rejected. |
| A new identical pending line hits the old pending fingerprint of a booked entry (edge) | medium | The fingerprint's occurrence index shifts when the first of two identical same-day pending lines is booked, so the second is taken for the first. Needs identical date, amount and label with no reference. Fixing it changes AD-7's keys. Deferred. |
| Two pending lines with one reference in a statement (edge) | low | `attachKeys` already gives the second its fingerprint only; banks do not repeat `entry_reference`. Rejected. |
| The bank lists the old pending line with new figures after booking (edge, verification) | low | A second pending entry lives beside the booked one until two misses delete it. Sure drops such lines against booked ones; deferred with the lingering-pending entry. |
| A booked line absorbs a pending entry whose stored reference differs (edge) | false | By design: banks change the reference between pending and booked, which is why AD-17 falls back to the amount. |
| A pending entry whose date the user moved later is missed (edge) | low | Needs a user to edit a pending entry's date past the window; rare. Rejected. |

## Design Notes

Archant counts pending in balances where Sure excludes them (`Entry.excluding_pending`): AD-8 decided it, and the story's purpose is a current balance. The bank's `ITBD` leaves pending out, hence the addition on top of the anchor. Without it, every day before the pending date would be off by its amount.

Sure keeps stale Enable Banking pending entries forever; Archant deletes them after two misses per AD-17. The window widening makes a miss real: a hotel pre-authorisation older than the 7-day overlap would otherwise vanish from the request and be deleted while still pending.

Known gap: a line already imported from a file that the bank still reports as pending gives a pending entry beside the file entry, and the booked line then absorbs the pending one. Bank exports list booked lines only, so this needs a file taken mid-settlement; 10.6's merge fixes it by hand.

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck` -- expected: clean.
- `pnpm test` -- expected: green, 100 % branches on `connectors/**`, `domain/**`, `services/ledger.ts`.
- `pnpm test:e2e` -- expected: green, no request leaves loopback.

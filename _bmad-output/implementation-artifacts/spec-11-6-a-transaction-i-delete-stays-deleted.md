---
title: 'Story 11.6: A transaction I delete stays deleted'
type: 'bugfix'
created: '2026-09-25'
status: 'done'
baseline_commit: '777a53f7b93d49f407d29d3bdd6f82166caf5d48'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-11-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Deleting a transaction deletes its `entry_keys`, so the next sync, which reads from the last success minus 7 days, finds no key for the line and creates it again. A synced transaction the user deleted comes back.

**Approach:** When the user deletes an entry holding bank keys, keep those keys in a tombstone table. A sync never creates an entry, nor pairs a line with an existing entry, for a line whose key is tombstoned. Sure has no tombstone (its importer finds or creates by `external_id`); Archant departs from it here, as the epic asks.

## Boundaries & Constraints

**Always:**
- New table `deleted_entry_keys (account_id, source, key, deleted_at)`, primary key `(account_id, source, key)`, `account_id` FK `ON DELETE RESTRICT`, declared in `packages/data/schema/entry-keys.ts` so the oxlint override keeping it ledger-only already applies. Migration `0032` through `pnpm data generate`.
- Tombstoned: the keys whose `source` is in `BANK_CONNECTOR_IDS`, written by `deleteTransaction` and `bulkDeleteTransactions` (`origin: "user"`), `onConflictDoNothing`. The entry's file keys are deleted as today, so re-importing a file still brings it back.
- Ingest: a line resolved by a live key (present, absorbed, or recognised in its pending group) behaves as today. Any other line holding a tombstoned fingerprint or `ext:` key is dropped before step 3's amount match, pairing and creation: no entry, no key written, not counted as a miss or a duplicate. Tombstones are looked up in one batched query per statement, by account and source, like `entriesByKey`.
- `deleteAccount` deletes the account's tombstones. Disconnecting keeps them: they carry no connection, and a later connection of the same account reads the same source.
- `services/ledger.ts` and `domain/**` stay at 100 % branches.

**Never:** no tombstone for a pending entry deleted after two misses, an entry absorbed by `absorb`, a reverted import, or an entry with no bank key; no change to key formulas (AD-7); no fuzzy tombstone by amount or date; no way to lift a tombstone; no interface change, the confirmation already says « supprimée définitivement ».

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Booked line deleted | synced entry E (`ext:r1`, `fp`); user deletes E; next sync lists r1 | nothing created; tombstones for both keys | — |
| No reference | E holds `fp` only; deleted; re-listed | nothing created | — |
| Bulk delete | two synced entries deleted in bulk | both tombstoned, neither returns | — |
| Manual entry | no key; deleted | no tombstone | — |
| File and bank keys | E paired by sync with an OFX line; deleted | bank keys tombstoned, OFX keys gone; OFX re-import creates it | — |
| Manual entry near a tombstoned line | E deleted; manual entry M, same amount, 1 day apart; sync lists E's line | M keeps no bank key, nothing created | — |
| Pending deleted, booked with same reference | pending E (`ext:r1`) deleted; `BOOK` r1 arrives | nothing created | — |
| Pending deleted, no reference | pending E deleted; its booked version arrives with a new fingerprint | booked entry created (known limit) | — |
| Pending missed twice | E deleted by `countMissedSyncs` | no tombstone; line back later is created | — |
| Account deleted | account with tombstones | tombstones deleted, delete succeeds | — |

</frozen-after-approval>

## Code Map

- `packages/data/schema/entry-keys.ts:11-50` -- `ENTRY_KEY_SOURCES`, `entryKeys`; add `deletedEntryKeys` beside it with the same `source` check. `packages/data/types.ts` -- derived types. `packages/data/migrate.spec.ts` -- pattern for a migration test.
- `packages/api/src/services/ledger.ts:2401-2408` `deleteTransactionRows` -- shared by `deleteTransaction` (:2461) and `countMissedSyncs` (:2418-2455): tombstone in `deleteTransaction`, not in the helper. `:2652-2697` `bulkDeleteTransactions` repeats the delete inline; tombstone per chunk before `:2670`.
- `packages/api/src/services/ledger.ts:863-890` `entriesByKey` -- inner-joins `transactions`; add a sibling lookup for tombstones. `:1094-1266` `groupLines` -- drop tombstoned lines where a line falls to `remaining` or to the pending group's « created » outcome, before `absorbPending` and `pairCandidates` (:961-993).
- `packages/api/src/services/ledger.ts:3078-3125` `deleteAccount` -- delete tombstones beside `entryKeys` at :3087.
- `packages/api/src/services/ledger.spec.ts` -- `linkedChecking` (:6063), `sync` (:6074), `newBankLine` (:6089), `pendingLine`/`bookedLine`/`createdBySync` (:6299-6346), `keyRows` (:6092); test at :1319 (file keys deleted, re-import returns) must stay green.
- `packages/api/src/services/sync.spec.ts` -- `mockProvider`, `linkedAccount` (:103), `transactionCount` (:138), `vi.setSystemTime(NOW + DAY)`.
- `packages/web/e2e/bank-connections.spec.ts:305-358` sync flow, `age()` (:438-462) to pass the one-hour gate; `transactionRow` (:302). `TransactionSheet.tsx:843` « Supprimer ».
- `ARCHITECTURE-SPINE.md:124-128` AD-7, `:67` AD-2 table list; `docs/sure-parity.md:132` row « Create, edit, delete ».

## Tasks & Acceptance

**Execution:**
- [x] `packages/data/schema/entry-keys.ts`, `packages/data/drizzle/0032_*`, `packages/data/migrate.spec.ts` -- table, generated migration, a test that the table exists empty after migrating.
- [x] `packages/api/src/services/ledger.spec.ts` -- tests first, one per matrix row, driving `sync` and the delete functions.
- [x] `packages/api/src/services/ledger.ts` -- tombstone on user deletes, the ingest drop, `deleteAccount` cleanup; update the doc comments of `deleteTransaction`, `bulkDeleteTransactions`, `groupLines`.
- [x] `packages/api/src/services/sync.spec.ts` -- `syncConnection`, delete the created transaction through `deleteTransaction`, sync a day later over the same lines: `transactionCount` unchanged and balance without it.
- [x] `packages/api/src/app.spec.ts` -- `DELETE /api/transactions/:id` on a synced entry, then a sync: the row is not listed.
- [x] `packages/web/e2e/bank-connections.spec.ts` -- link, delete « Supermarché Démo » from its sheet, `age()`, « Synchroniser »: the row stays absent.
- [x] `ARCHITECTURE-SPINE.md`, `docs/sure-parity.md` -- AD-7 and AD-2 name `deleted_entry_keys`; parity row records the departure from Sure.

**Acceptance Criteria:**
- Given the finished story, when `pnpm test` and `pnpm test:e2e` run, then every matrix row has an automated test: Playwright for the deleted row staying absent after a sync, Vitest for the rest.

## Implementation Notes

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Evidence | Route |
|---|---|---|---|
| A new identical pending purchase without a reference, bought after the user deleted one twin, takes the tombstoned fingerprint index and is dropped; the adapted twin test hides it (blind, edge, claim) | low | Real: fingerprints of unreferenced pending lines carry an occurrence index (AD-17). Needs two identical same-day pending lines, one deleted, then a third identical purchase before booking. Not tombstoning pending fingerprints would bring every deleted unreferenced pending line straight back, which the intent forbids. | rejected, recorded in Design Notes |
| A line with an unknown `ext:` key is dropped because its fingerprint is tombstoned after an index shift (edge) | medium | `isTombstoned` checks both keys; a reference is the stabler identity, so a new referenced line must be judged by its reference alone. | patch |
| A pending line whose `ext:` key is tombstoned can be recognised onto an unreferenced live twin by `assignIdentical`, before the tombstone check (edge, claim) | low | Group recognition runs before `isTombstoned`; the filter is a one-line drop of referenced lines with a tombstoned reference before the group. | patch |
| No test shows a tombstoned booked line is kept from absorbing a live pending entry of the same amount (verification gap) | medium | Every test reaching `absorbPending` has no survivor; moving the filter after it stays green. | patch |
| `deleted_entry_keys.source` accepts file sources (blind) | low | Only bank keys are written; typing it `BankConnectorId` with a check on `BANK_CONNECTOR_IDS` is a direct correction before `0032` ships. | patch |
| Test title « listed under a new reference » relists the same reference `r9` (blind) | low | Direct rename. | patch |
| `sync.spec.ts` asserts a hard-coded count of 5 (blind) | low | Deriving it from the count before the delete is a direct correction. | patch |
| Two doc comments wrap mid-sentence (blind) | low | `bulkDeleteTransactions`, `deleteAccount`. | patch |
| Tombstone lookup also runs for file imports (blind, edge) | low | One indexed query returning nothing; a guard adds a branch for no user-visible gain. | rejected |
| Dropped lines are not counted anywhere (blind) | low | The frozen intent says they are not counted; a counter adds public surface. | rejected |
| `deleted_at` is never read (blind) | low | Records when, like every other table's timestamps; no retention is planned since a reconnection rereads up to 90 days. | rejected |
| No test for disconnect, cross-account scoping, merge or revert leaving no tombstone, or a sync after the file re-import (blind) | low | No code path of those touches `deleted_entry_keys`; lookups and the account delete filter on `account_id`. | rejected |
| `app.spec.ts` uses `netflix?.id ?? ""` and has no bulk-delete route test (blind) | low | A missing row fails the test with a 404; bulk delete is covered in `ledger.spec.ts`. | rejected |
| Spec `in-review` while sprint says `in-progress` (blind) | false | Sprint status moves at presentation, by design. | rejected |

## Design Notes

A separate table rather than a nullable `entry_keys.entry_id`: every query joining `entry_keys` to `entries` (`entriesByKey`, `pairCandidates`, `unclaimedBeyond`, `entryOrigins`) assumes a key names a live entry, and a tombstone must not block `attachKeys` from giving a live entry a key the user once deleted elsewhere.

Dropping only the lines no live key resolves keeps identity rules intact: of two identical pending lines, one deleted, the other still finds its entry through its group even after its fingerprint index shifts onto the tombstoned one.

A pending line without a reference that the user deleted comes back once booked, since the booked line has another fingerprint. Matching it by amount would need the deleted amount and date kept, which the epic's « bank keys » does not cover.

A line with a reference is judged by its reference alone, a line without one by its fingerprint. Unreferenced pending fingerprints carry an occurrence index, so after the user deletes one of two identical same-day pending lines, a third identical purchase listed before either books can take the tombstoned index and be dropped. Not tombstoning pending fingerprints would instead bring every deleted unreferenced pending line straight back.

## Verification

**Commands:**
- `pnpm typecheck && pnpm lint:code && pnpm test` -- expected: green, 100 % branches on `domain/**`, `services/ledger.ts`.
- `pnpm test:e2e` -- expected: green.

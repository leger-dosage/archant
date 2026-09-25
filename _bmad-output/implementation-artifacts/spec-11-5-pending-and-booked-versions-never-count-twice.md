---
title: 'Story 11.5: Pending and booked versions never count twice'
type: 'bugfix'
created: '2026-09-25'
status: 'done'
baseline_commit: 'c9fa769d14a3287fdc7f03ef7d7056decd16a058'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-11-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Four ways a pending card payment is counted twice or loses its identity. A bank listing a pending line beside its booked version yields two entries. Two button syncs an hour apart delete a pending entry the bank dropped a little before booking it. A pending line refused by step 1 (e.g. `BEFORE_OPENING_DATE`) leaves its entry counted as missed. Of two identical same-day pending lines, the second's fingerprint shifts once the first is booked (its occurrence index drops from 1 to 0), so it is taken for the first, its own entry is deleted after two misses, and it comes back as a new entry when booked.

**Approach:** Drop the settled pending line in the connector as Sure's `EnableBankingItem::Importer` does; count at most one miss per day in the app zone; let a refused line vouch for the entry it names; recognise a pending line by its `entry_reference` first, else within its group of identical pending lines rather than by its shifting fingerprint.

## Boundaries & Constraints

**Always:**
- Settled pending (connector, same response): a `PDNG` line is dropped when a `BOOK` line of that response has the same `entry_reference`, or the same Sure `compute_external_id`: `transaction_id`, else `entry_reference`, else the content key `withoutRepeats` already uses. Runs on raw lines beside `withoutRepeats`.
- Misses: a miss counts only when the entry's last miss is `null` or earlier than today (`today(deps.timeZone)`); counting sets it to today; the second counted miss deletes the entry. Absorbing or refreshing an entry resets both count and date. New nullable column `transactions.pending_missed_on` (IsoDate text), migration `0031` through `pnpm data generate`; existing rows get `null`.
- Refused lines: when a sync refuses a line in step 1, a key of that line (fingerprint or `ext:`) naming a pending entry of the connection puts that entry in the miss count's `seen` set.
- Pending recognition (sync only): a pending line whose `ext:` key names an entry is recognised by that key, before its fingerprint (today the fingerprint comes first, so a shifted index wins over a reference). Any other pending line joins the group of accepted pending lines with the same date, amount and normalised label. The group's candidates are the connection's pending entries not claimed earlier in the statement that hold a fingerprint of that group (`fp:` of the triple at any occurrence index), ordered by the lowest index they hold, then `createdAt`, then id. Lines, in statement order, take the last candidates: the bank books the oldest of identical lines first. A line left over whose fingerprint names a booked entry is present; any other is created. Candidates left over stay for step 3's amount match, then the miss count.
- Booked lines keep today's lookup (`fp` then `ext`) and step 3's amount match within 5 days.
- `connectors/**`, `domain/**` and `services/ledger.ts` stay at 100 % branches. Logs gain nothing.

**Never:** no change to fingerprint or `ext:` key formulas, and no recomputed stored key (AD-7); no matching on `transaction_id` across two responses; no amount-based merge of a pending line with a booked one listed beside it without a shared reference or fingerprint (a second purchase of the same amount stays); no change to imports, the sync window or the one-hour spacing between syncs; no interface change.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Pending beside booked, same reference | first sync lists `BOOK` r1 and `PDNG` r1, different dates | one booked entry | — |
| Same, after a pending sync | pending entry E (r1); then `BOOK` r1 + `PDNG` r1 | E booked in place, one entry | — |
| Same `transaction_id`, references differ | `BOOK` t1/r2, `PDNG` t1/r1 | pending line dropped | — |
| No shared id, same amount, new label | `BOOK` and `PDNG`, no reference | two entries, as today | — |
| Two syncs one hour apart | pending entry absent from both | missed once | — |
| Absent on two different days | day 1, day 2 | deleted on day 2 | — |
| Refused line | pending line now dated on or before the opening date, names E | E not missed | — |
| Identical pending, first booked | E1, E2 same triple; then `BOOK` (new label) + one `PDNG` | `PDNG` refreshes E2, `BOOK` absorbs E1, nothing missed | — |
| Identical pending, order swapped next sync | E1 booked holding fp0; `PDNG` then `BOOK` | `PDNG` stays E2, no new entry | — |
| Second booked in turn | E2 pending; `BOOK` of it | E2 booked, same id | — |
| Pending line re-listed beside booked, no reference | E1 booked holding fp0, E2 pending; `PDNG`×2 + `BOOK` | one `PDNG` refreshes E2, the other is present on E1 | — |

</frozen-after-approval>

## Code Map

- `packages/api/src/connectors/enable-banking/client.ts:114-160` -- `rankOf`, `contentKey`, `withoutRepeats`; add the settled-pending rule on raw lines (reuse `contentKey`), wired where `fetchStatement` calls `withoutRepeats`. `transaction_id` is already in `transactionSchema`.
- `packages/api/src/domain/pending.ts` -- `absorbPending`, `MAX_MISSED_SYNCS`; add a pure function assigning a group's pending lines to its ordered candidates, aligned on the last ones.
- `packages/api/src/domain/keys.ts:32-51` -- `lineKeys`; export the fingerprint of a triple at an index so the ledger can compute a group's fingerprints without duplicating the hash.
- `packages/api/src/services/ledger.ts:1037-1127` -- `groupLines`: split pending lines without an `ext:` hit out of the key loop, resolve them by group before `absorbPending`, add group-claimed entries to `claimed`. `:850-878` `entriesByKey`, `:887-906` `pendingOfConnection` (select the new column; a keys query for the candidates' `fp:` keys).
- `packages/api/src/services/ledger.ts:1291-1308,1480-1493` -- `ingest` step 1 keeps refused lines' keys; look them up and extend `seen`. Pass `context.today` to `countMissedSyncs`.
- `packages/api/src/services/ledger.ts:2084-2128` `absorb` resets `pendingMissedOn`; `:2238-2266` `countMissedSyncs` applies the day rule.
- `packages/data/schema/transactions.ts:55-58` -- add `pendingMissedOn`; update the comment on `pendingMissedSyncs` (« consecutive » becomes « on different days »). `packages/data/migrate.spec.ts:1393-1435` -- pattern for the migration test.
- `packages/api/src/services/ledger.spec.ts:6300-6700` -- `pendingLine`, `bookedLine`, `sync`, `createdBySync`, `rowOf` (add `missedOn`), `linkedChecking`. The test at `:6603` runs two misses on one day: move the clock between them. `:6679` must stay green (no shared id, two entries).
- `packages/api/src/services/sync.spec.ts:430-470` -- `mockProvider`, `withoutPending`, `vi.setSystemTime(NOW + DAY)`, `pendingOf`.
- `packages/web/e2e/fake-enable-banking.ts:80-140` -- `transactionsPage`; `packages/web/e2e/bank-connections.spec.ts:310-330` asserts rows and balance after linking.
- `ARCHITECTURE-SPINE.md:184-188` AD-17 and `:194` AD-18; `docs/sure-parity.md:119` « Pending lines » row.

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/connectors/enable-banking/client.spec.ts` -- tests first: pending dropped on shared `entry_reference`, on shared `transaction_id`, on equal content; kept when the booked line shares nothing; booked lines never dropped.
- [x] `packages/api/src/domain/pending.spec.ts`, `keys.spec.ts` -- tests first for the group assignment (more lines than candidates, fewer, equal, empty) and the exported fingerprint equal to `lineKeys`'s.
- [x] `packages/data/schema/transactions.ts`, `packages/data/drizzle/0031_*`, `migrate.spec.ts` -- column, generated migration, a test that existing pending rows get `null`.
- [x] `packages/api/src/services/ledger.spec.ts` -- tests first: one per matrix row from « Same, after a pending sync » down, driving `sync` with lines and the system clock.
- [x] `packages/api/src/services/ledger.ts`, `domain/pending.ts`, `domain/keys.ts` -- the changes above; update the doc comments of `groupLines`, `ingest`, `absorb`, `countMissedSyncs`.
- [x] `packages/api/src/services/sync.spec.ts` -- two `syncConnection` calls one hour apart without the pending line leave it missed once; pending beside booked with one reference ends as one entry and the right `balanceOn`.
- [x] `packages/web/e2e/fake-enable-banking.ts`, `bank-connections.spec.ts` -- the fake also lists a `PDNG` copy of the groceries line with its `entry_reference`, dated the day after; the test asserts one « Supermarché Démo » row and the balance unchanged.
- [x] `ARCHITECTURE-SPINE.md`, `docs/sure-parity.md` -- AD-17: misses on different days, pending recognition by reference then group; AD-18: settled pending dropped; parity row updated.

**Acceptance Criteria:**
- Given the finished story, when `pnpm test` and `pnpm test:e2e` run, then every matrix row has an automated test: Playwright for the pending-beside-booked row shown after linking, Vitest for the rest.

## Implementation Notes

- A pending line left over by its group whose fingerprint names a booked entry, or a pending one another line of the statement refreshed, is present on it, unless the line carries a reference and the entry is pending: then it is created, and its fingerprint stays with the entry already holding it (`sharing` in `services/ledger.ts`).
- Review fixes: the occurrence search is capped at `MAX_IDENTICAL_LINES` (100) instead of a bound drawn from the account's key count, which fell short once earlier twins were deleted; a line with a reference never takes a group candidate holding one, so a new purchase no longer takes over the entry of an absent one.
- The settled-pending rule is `withoutSettledPending` in the connector; its `transaction_id` and `entry_reference` identities share one namespace, as Sure's `compute_external_id` does.

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Evidence | Route |
|---|---|---|---|
| Occurrence bound `held.size + fp count` misses a twin whose earlier twins were deleted (blind, edge, claim) | medium | Three twins, two deleted with their keys: bound 2, fp2 never tried, the line is created again. | patch |
| Every group hashes up to the account's fp count per sync (blind, edge) | medium | Held keys of other triples never leave `unattributed`, so the early stop rarely fires. Same fix as the bound. | patch |
| A pending line with an unknown reference takes a twin holding another reference, and a purchase is lost once that twin books (blind) | high | E2 `ext:r2` absent, new r3 takes E2, `BOOK` r2 books E2, next `PDNG` r3 is present on it. | patch |
| `like 'fp:%'` written as raw SQL (blind) | low | AGENTS.md forbids raw SQL; Drizzle covers it. | patch |
| `Math.max` over a single-row count (blind) | low | Gone with the bound fix. | patch |
| AD-17 omits the id tie-break and the booked/pending lookup asymmetry (blind) | low | Direct doc correction. | patch |
| A miss before and one after midnight delete the entry (blind) | low | The frozen intent asks for exactly « a later day ». | rejected |
| Rows with one miss before `0031` get `null` and can go on a same-day second miss (blind) | low | One transition, one household; the column cannot know the app zone's day of the past miss. | rejected |
| Content branch of `identityOf` duplicates `withoutRepeats` (blind) | low | Harmless; mirrors Sure's `compute_external_id`. | rejected |
| `transaction_id` and `entry_reference` share one namespace (blind) | low | Sure does the same; a collision between two banks' ids of one account is unlikely. | rejected |
| Refused lines vouch by fingerprint and for booked entries (blind, edge, claim) | low | `countMissedSyncs` filters pending entries anyway; a refused line still listed means the bank still lists the operation. | rejected |
| Spec `in-review` while sprint says `in-progress` (blind) | false | Sprint status moves at presentation, by design. | rejected |
| Parity row mixes parity and difference (blind) | low | Wording only. | rejected |
| Fixtures date the pending copy after the booked one (blind) | low | The drop is by reference; the date plays no part. | rejected |
| Missing tests: present not in `seen`, entry holding two triples, both filters combined (blind) | low | A present pending entry is always claimed, so already in `seen`; the others compose tested paths. | rejected |
| A booked line refused by `toTransaction` still settles its pending copy (edge) | low | Needs a bank sending a booked line with an unreadable amount; Sure behaves the same. | rejected |
| A booked line with the twins' triple, listed after a pending twin, books the other twin (edge, claim) | low | Ids swap between two indistinguishable lines; counts and balances stay right, nothing is deleted. | rejected |
| A new pending purchase with an unknown reference whose fingerprint names a booked entry is taken as present (implementation report) | medium | Pre-existing: pending lines were looked up fingerprint first before this story. | defer |
| Verification gap layer | false | No gap found. | rejected |

## Design Notes

A booked line whose pending version the connector dropped still finds the stored pending entry, by its `ext:` key or by amount within 5 days. The one case left is a pending line matched only by `transaction_id`, with another `entry_reference` and another amount: its entry counts until two misses on two days delete it. Sure closes it by keying on `transaction_id`, which AD-18 refuses because some banks change it between reads.

The group rule replaces the fingerprint as the identity of a pending line without a known reference. Identical lines are indistinguishable, so only their count and order carry information; aligning on the last candidates keeps the second line's entry when the first one is booked, and is the only choice under which the matrix rows hold without changing AD-7's keys.

## Verification

**Commands:**
- `pnpm typecheck && pnpm lint:code && pnpm test` -- expected: green, 100 % branches on `connectors/**`, `domain/**`, `services/ledger.ts`.
- `pnpm test:e2e` -- expected: green.

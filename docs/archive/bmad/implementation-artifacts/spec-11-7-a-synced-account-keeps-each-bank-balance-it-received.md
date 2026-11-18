---
title: 'Story 11.7: A synced account keeps each bank balance it received'
type: 'bugfix'
created: '2026-09-25'
status: 'done'
baseline_commit: '669ffa520ef132a8a9ef759acc94647a8d23ba07'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-11-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Each sync deletes the account's `current_anchor` and writes the new bank balance in its place (`writeCurrentAnchor`), so the backward computation derives every past day from the latest figure alone. A line the bank never sent, or one the user deleted, shifts the whole history back to the opening date, and net worth with it.

**Approach:** Two steps, both as Sure. First, pending transactions leave every balance, as Sure's `Entry.excluding_pending`: they stay listed with « En attente » and out of cash flow, but a linked account's balance is the bank's booked figure. Then, as `Account::CurrentBalanceManager#preserve_anchor_as_reconciliation_if_stale`, before a sync writes a bank balance dated another day than the current anchor, the current anchor becomes a `reconciliation` on its own date; a balance dated the same day updates the anchor in place. `reverseBalances` already fixes every reconciliation's day, so a missing line only moves the days between the two bank figures around it.

## Boundaries & Constraints

**Always:**
- Decision (owner, 2026-09-25): the divergence « pending transactions count in balances » (AD-8, AD-18, Spec 10.4) is withdrawn; it had no requirement behind it and made a booked bank figure unusable as a fixed point. Every movement read that feeds `balances` or a snapshot gap filters `transactions.pending = false`; the pending top-up on the anchor goes. Existing stored balances are corrected by the next recompute, no migration.
- Only the sync path of `ingest` (step 7, `anchorPlan` recorded) rotates. `linkBankAccount` and `unlinkBankAccount` keep their anchor handling; unlink's reconciliation now holds the booked figure, since that is what the page shows.
- Rotation and anchor write happen in the ingest's `immediate` transaction, before the recompute; the converted row keeps its entry id, `import_id` stays `null`.
- The old anchor is converted when its date is earlier than the new anchor's date; on the same date or a later one it is updated in place, amount and date, as Sure's `update_current_anchor` (amended after review, 2026-09-25: converting a later anchor froze a stale figure).
- A day that already holds a reconciliation (user snapshot or file statement balance) keeps it: the old anchor is deleted instead, as AD-8 lets the user's value win over a file's.
- An old anchor dated on or before the opening date is deleted, not converted: Spec 1.4 refuses a snapshot there.
- A sync that writes no anchor (no balance, `CURRENCY_MISMATCH`) touches nothing, as today.
- Converted reconciliations are ordinary snapshots: listed, edited and deleted through the existing routes and `SnapshotList`.
- AD-8 and AD-18 in the architecture spine describe the chain and the booked-only balance; `docs/sure-parity.md` rows « Pending transactions » and « Earlier bank balances » become Parity.
- `services/ledger.ts` and `domain/**` stay at 100 % branches.

**Never:** no backfill of figures received before this story; no new column, endpoint or interface component; no change to pending storage, absorption, miss counting, cash flow or the « En attente » badge; no change to `reverseBalances`'s rule that a reconciliation fixes its day in both directions; no rotation on link, relink or unlink.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Pending left out | `ITBD` 1 000, pending −12 today | balance today 1 000; row listed « En attente » | — |
| Pending on a manual account | unlinked account holding a pending entry | forward balance ignores it | — |
| New day | anchor A (D1, 1 000); sync brings 900 dated D2 > D1 | reconciliation D1 = 1 000 with A's id; anchor D2 = 900 | — |
| Same day | anchor D1 = 1 000; sync brings 950 dated D1 | anchor D1 = 950, no reconciliation | — |
| Missing line | reconciliation D1 = 1 000, booked lines D1+1..D2 sum −50, anchor D2 = 900 | days ≤ D1 unchanged, days D1+1..D2−1 shifted by −50; net worth before D1 unchanged | — |
| Pending across a figure | pending −30 dated D1 when D1's anchor is converted; books on D3 | days ≤ D1 never move; D3 drops by 30 | — |
| Earlier date | anchor dated today (bank gave no date); next sync dated yesterday | anchor moved to yesterday with the new amount, same id, no reconciliation | — |
| Day already snapshotted | user snapshot on D1; anchor D1; sync dated D2 | user snapshot kept, old anchor deleted | — |
| On opening date | anchor dated on or before the opening date; sync dated later | old anchor deleted, no reconciliation | — |
| No balance or other currency | anchor D1; sync without a usable balance | anchor D1 unchanged | — |
| Unlink after a chain | reconciliations D1, D2; anchor D3; unlink | stored balances unchanged | — |

</frozen-after-approval>

## Code Map

- `packages/api/src/services/ledger.ts:227-275` `recomputeBackward` -- drop the pending top-up (:234-251) and filter pending out of `movements` (:254-258). `:338-353` forward recompute, `:667-677` `unlinkBankAccount` movements, `:4590-4600` `gapReader` movements: same filter (join `transactions`). `lastBalanceDay` (:215) may keep pending dates: it only extends the range.
- `ledger.ts:474-503` `writeCurrentAnchor` -- delete-and-insert; the rotation goes on the sync caller only (`:1791-1794`). `linkBankAccount` (:517) and `unlinkBankAccount` (:638) also call it.
- `ledger.ts:465-471` `anchorDate`, `:1452-1466` `planCurrentAnchor`; `:4397` `snapshotOn`; `:4390` `snapshotRejection` for the opening-date rule.
- `packages/api/src/domain/balances/reverse.ts` -- no change expected; `reverse.spec.ts` gets the « missing line between two figures » case if not covered.
- `packages/data/schema/entries.ts:61` `entries_one_reconciliation_per_day` -- forces the « day already snapshotted » rule.
- `packages/api/src/services/ledger.spec.ts` -- `valuationsOf` (:5721), `linkedChecking` (:6063), `sync` (:6074); « keys its lines … and rewrites the anchor » (:6104), « dates the anchor … » (:6145), « keeps the anchor … » (:6169) assume replacement; pending tests asserting a balance with the pending amount change too.
- `packages/api/src/services/sync.spec.ts:255` `anchorOf`, `vi.setSystemTime(NOW + DAY)` for a second-day sync.
- `packages/web/e2e/bank-connections.spec.ts:246,279,283,317-318` expect 1 231,36 € (booked less pending): becomes 1 234,56 €. `fake-enable-banking.ts:365-388` balance route has no `reference_date`; `age()` (:469) passes the one-hour gate; `packages/web/src/components/SnapshotList.tsx`.
- `ARCHITECTURE-SPINE.md` (under `_bmad-output/planning-artifacts/architecture/architecture-archant-2026-09-21/`) :134 AD-8, :194 AD-18; `docs/sure-parity.md:78,81`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/services/ledger.spec.ts` -- tests first, one per matrix row, through `sync` with statement balances on different days; update the tests that assert replacement or a pending-inclusive balance.
- [x] `packages/api/src/services/ledger.ts` -- pending filter on every balance movement read, top-up removed; rotation on the sync path; doc comments of `recomputeBackward`, `writeCurrentAnchor`, `planCurrentAnchor`, `unlinkBankAccount`, `ingest` step 7.
- [x] `packages/api/src/domain/balances/reverse.spec.ts` -- a line missing between a reconciliation and the anchor moves only the days between them.
- [x] `packages/api/src/services/sync.spec.ts` -- `syncConnection` on day 1, then day 2 with another balance: `anchorOf` is day 2, day 1 is a reconciliation, net worth before day 1 unchanged.
- [x] `packages/web/e2e/fake-enable-banking.ts`, `packages/web/e2e/bank-connections.spec.ts` -- balances without pending (1 234,56 €); a bank reporting a balance dated yesterday, then another dated today: after the second sync (`age()`), the account's snapshot list shows yesterday's bank figure.
- [x] `ARCHITECTURE-SPINE.md`, `docs/sure-parity.md` -- AD-8 (chain of reconciliations, pending out of balances), AD-18 (no « pending applied on top »); both parity rows set to Parity.

**Acceptance Criteria:**
- Given the finished story, when `pnpm test` and `pnpm test:e2e` run, then every matrix row has an automated test: Playwright for the booked balance and the bank figure in the snapshot list, Vitest for the rest.

## Implementation Notes

`bookedMovements` in `ledger.ts` is the one query every balance reads its movements from (backward, forward, unlink, snapshot gap). `rotateCurrentAnchor` is called by `ingest` step 7 only, with the opening date the same ingest may have moved. The e2e fake adds `DATED_BANK`, whose balance is dated yesterday for the link and the sync it starts, then today.

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Evidence | Route |
|---|---|---|---|
| An anchor dated after the new balance is converted, freezing a stale figure; a later rotation onto that day then deletes the fresh anchor (blind, edge) | medium | `rotateCurrentAnchor` converted any other date; `snapshotOn` then found the stale reconciliation. Sure only converts an earlier anchor and otherwise updates it in place, which settles it. | patch, matrix row « Earlier date » amended |
| A bank reference date moving back onto an existing reconciliation leaves anchor and reconciliation on one day (edge) | low | Needs the bank's reference date to go back more than a day across syncs; a guard adds a branch for a case not seen with Enable Banking. | rejected |
| A converted bank figure has `import_id` null, so a later file statement balance on that day is kept as the user's (blind, edge) | low | Real, but needs a file imported into a bank-linked account on a day a bank figure holds; the bank's figure winning is acceptable, a marker would need a column. | rejected |
| `writeCurrentAnchor` comment says only link and unlink call it (blind) | low | `rotateCurrentAnchor` calls it. Direct rewording. | patch |
| « Existing balances are corrected by the next recompute » misses accounts unlinked before this story, whose balances and last reconciliation hold pending amounts (blind, edge) | low | Real for pre-story data only; no real bank has been connected yet (epic 11 context). A one-off recompute adds startup code for no known instance. | rejected, recorded in Design Notes |
| Pending entries of an unlinked account stay pending forever and count nowhere (blind) | low | Pre-existing lifecycle; Sure behaves the same. | rejected |
| No tests for a file reconciliation on the old anchor's day, an anchor strictly before the opening date, `CURRENCY_MISMATCH` beside a reconciliation (blind) | low | Same branches as tested cases; 100 % branch coverage holds. | rejected |
| `linkedOn(null, 0)` then relinking with `null` is a roundabout setup (blind) | low | Test readability only. | rejected |
| The fake bank counts balance reads; `dated.set(cardUid, 0)` is unused (blind) | low | The count is documented in the fake; the card entry is dead code, a direct deletion. | patch (deletion) |
| Planning documents (`epics.md` Story 10.4, `epic-10-context.md`) still say pending counts in balances (blind) | low | Historical planning of a done epic; AD-8, AD-18 and the parity doc carry the current rule. | rejected |
| Spec status and sprint status disagree, tasks unticked (blind) | false | Status moves by workflow step; tasks are ticked at step 3's audit. | rejected |
| Test comment « Without the missing line… » describes a computation the test does not assert (blind) | low | Direct correction. | patch |
| No test shows `gapReader` leaves pending out (verification) | medium | Reverting the filter fails no test. | patch |
| No test shows `unlinkBankAccount` leaves pending out of its movements (verification) | medium | Reverting the filter fails no test; the unlink test uses `toContainEqual`. | patch |

## Design Notes

Sure converts only a previous-day anchor because its anchor is always dated today. Archant dates the anchor on the bank's `reference_date` capped at today (Spec 10.3), so « stale » means « another date than the new one », including an earlier one.

Why pending leaves balances first: a bank balance is booked. With pending lines counted, a converted figure either needs a marker and a pending top-up at every read, or shifts every earlier day by the pending amount until the line books. Sure avoids both by never counting pending; so does Archant from this story on.

Balances stored before this story on an account unlinked earlier keep their pending amounts until a write recomputes them; no real bank had been connected when this shipped.

## Verification

**Commands:**
- `pnpm typecheck && pnpm lint:code && pnpm test` -- expected: green, 100 % branches on `domain/**`, `services/ledger.ts`.
- `pnpm test:e2e` -- expected: green.

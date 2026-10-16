---
title: "Story 28.17: Honour a linked account's opening balance"
type: 'feature'
created: '2026-10-16'
status: 'done'
baseline_commit: '032dd815a48f7c283cb27cb780c4786d6585296f'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-28-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Sure's `Balance::ReverseCalculator` honours a linked account's opening anchor: on `opening_anchor_date` the day ends at the anchor's amount (`use_opening_anchor_for_date?`), the day before starts from it without undoing that day's flows, and the next day bridges the gap as a cash adjustment (`opening_boundary_adjustment`). Archant's `reverseBalances` ignores the anchor's amount, so every exception built on that premise follows: the « Solde d'ouverture » row of a linked account opens nothing, the ledger refuses the opening balance with `ACCOUNT_LINKED`, a snapshot on its opening date is refused as taken, and a file's statement balance on it is skipped with `OPENING_DATE`.

**Approach:** `reverseBalances` takes the opening anchor and treats its day as Sure does; `recomputeBackward` reads it. With the premise gone, a linked account's opening balance behaves as a manual account's: the sheet opens for an administrator, the ledger moves it, a snapshot on its date sets its amount, a statement balance on its date is kept against it. `set_opening_balance` alone keeps refusing a linked account with Sure's `linked_account`. Existing linked accounts are recomputed once at start, as Story 28.9 did for non-cash accounts.

## Boundaries & Constraints

**Always:**
- Backward pass, Sure's loop from the current anchor down to `calculation_start_date`: the opening date ends at the opening anchor's amount; the day before it starts from that amount, the opening day's movements undone for nothing; each other day as today. The day after the opening date keeps its derived balance, so the gap between the two days is the cash adjustment Sure records there. Archant stores no per-day flow breakdown (Sure's `start_*`, `*_flows`, `cash_adjustments` columns and its `BalanceReconciliation` drawer have no Archant counterpart), so the adjustment lives in the two stored balances, not in a column.
- The opening date on or after the current anchor's date, which Sure never meets since its anchor is today: the opening anchor still ends its own day, as a valuation in the forward pass after the anchor, and on the anchor's own day it wins, as Sure's check runs before the anchor's.
- A snapshot's `computed` on the day before a linked account's opening date reads the opening day's balance with no movement undone, as the pass does.
- `PATCH /api/accounts/:id/opening-balance` and the ledger's `setOpeningBalance` move a linked account's anchor as a manual one's; the « Solde d'ouverture » row opens `OpeningBalanceSheet` for an administrator whatever the account.
- `set_opening_balance` refuses a linked account with `linked_account` before anything else, as today.
- A snapshot on a linked account's opening date sets the anchor's amount (Sure's `ReconciliationManager` updates the valuation on its date); a statement balance there is kept against the anchor as on a manual account.
- Once per instance, `linked_balances_recomputed_at` claimed in the same transaction (AD-12): every account with `bank_account_id` set and a `current_anchor` is recomputed.
- AD-8 and AD-12 change with this story; `docs/sure-parity.md` rows « Opening amount on a linked account », « Editing the opening balance » and « Snapshot on the opening date » follow.

**Never:** no flow or adjustment column on `balances`; no change to `rotateCurrentAnchor` (the opening anchor already holds its day against a superseded bank figure) nor to the bank's balance date (Story 28.18); no change to the refusals Story 28.20 owns; no change to `set_opening_balance`'s refusal.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Anchor honoured | opening 01 at 500, bank 1 000 on 05, nothing moves | 01: 500; 02–05: 1 000 | none |
| Opening day's movements | line −50 on 01 | 01: 500; day before 01 (an older line): 500 | none |
| Before the anchor | line on 31/08, before opening 01 | 31/08 starts from 500, its own line undone as any day | none |
| Day after | line −20 on 02 | 02: derived from 03; adjustment = 02 − 500 − (−20) | none |
| Opening on anchor's day | both on 05 | 05: opening amount; later days forward from it | none |
| Opening after anchor | anchor 05, opening 07 | 05–06 from the bank, 07 the opening amount, 08 on from it | none |
| Sheet on a linked account | admin, « Solde d'ouverture » | sheet opens, saving recomputes | refusals as a manual account's |
| Viewer | linked account | row opens nothing | `403` from the API |
| Assistant | `set_opening_balance` on a linked account | `linked_account` | refused, nothing written |
| Snapshot on opening date | linked account | anchor's amount set, `replaced_existing` | none |
| Existing instance | linked account stored before | recomputed once at start | failure rolls the claim back |

</frozen-after-approval>

## Code Map

- `packages/api/src/domain/balances/reverse.ts` -- `ReverseInput.opening`; the opening day and the day before; forward part after the anchor takes it as a valuation.
- `packages/api/src/services/ledger/balances.ts` -- `recomputeBackward` reads the opening anchor; `recomputeLinkedBalances` beside `recomputeNonCashBalances`, sharing one claim helper.
- `packages/api/src/index.ts` -- calls it at start.
- `packages/api/src/services/ledger/opening.ts` -- drop `ACCOUNT_LINKED`; `services/accounts.ts` `openingRejection` follows.
- `packages/api/src/services/ledger/snapshots.ts` -- `recordSnapshot` sets a linked account's anchor; `gapReader` reads the opening day as the pass does; `services/snapshots.ts` drops the `OPENING_DATE` field mapping.
- `packages/api/src/services/ledger/ingest.ts` -- `planStatementBalance` keeps a linked account's anchor as a manual one's; the `OPENING_DATE` skip reason goes, with `mcp/imports.ts`' description and its `fr.json` line.
- `packages/api/src/services/ledger/export.ts`, `services/bank-connections.ts` -- comments that say the amount is ignored.
- `packages/app/src/routes/_authed.accounts.$accountId.tsx`, `components/SnapshotList.tsx` -- the row opens the sheet for an administrator on any account.
- `docs/architecture.md` (AD-8, AD-12), `docs/sure-parity.md` (three rows).
- Sure, read-only at `~/github/sure`: `app/models/balance/reverse_calculator.rb`, `base_calculator.rb`, `account/opening_balance_manager.rb`, `account/reconciliation_manager.rb`, `account.rb#create_and_sync`.

## Tasks & Acceptance

**Execution:**
- [x] `domain/balances/reverse.spec.ts` -- the opening day, the day before, the day after and its gap, the opening day's movements, opening on and after the anchor's day; failing first.
- [x] `services/ledger/balances.spec.ts` -- a linked account's history honours the anchor; `recomputeLinkedBalances` once, claim rolled back on failure.
- [x] `services/ledger/opening.spec.ts`, `routes/accounts.spec.ts` -- a linked account's opening balance moves and recomputes; `mcp/opening-balance.spec.ts` keeps `linked_account`.
- [x] `services/ledger/snapshots.spec.ts`, `ingest.spec.ts`, `bank-link.spec.ts`, `export.spec.ts` -- updated to the honoured anchor.
- [x] `e2e/bank-connections.spec.ts` -- an administrator edits a linked account's opening balance; the day shows it, the next day and the current balance stay.
- [x] Code, then AD-8, AD-12 and the parity rows.

**Acceptance Criteria:**
- Given the finished story, when `pnpm test` and `pnpm test:e2e` run, then both pass, and screenshots of the linked account's « Soldes » with the sheet open, light and dark, desktop and phone width, are reviewed against Sure's valuation drawer.

## Design Notes

Assumptions taken alone, each settled by Sure. The adjustment has no column: Archant keeps one balance per day and shows no flow breakdown, so the gap between the opening day and the next is the adjustment, as Sure's `cash_adjustments` is `end − start − flows` of that row. The opening day wins on the anchor's own day, as Sure's `use_opening_anchor_for_date?` runs before anything else in its loop. The snapshot and file exceptions existed only because the amount was ignored; Sure's `ReconciliationManager` updates whatever valuation holds the date, so they go. A linked account created by Archant gets the bank's balance two years back as its opening, as Sure's `create_and_sync` does, so its history now shows Sure's jump on the day after the opening date. `set_opening_balance` keeps its refusal, as the story asks.

## Implementation Notes

- `reverseBalances` takes `opening`; on the anchor's own day the opening wins, and after the anchor it joins the forward pass's valuations, last so it wins its day.
- `recomputeBackward` reads the opening anchor beside the reconciliations through `accountWithOpeningDate`.
- `recomputeOnce` holds the claim-and-recompute both start-time recomputes share; `recomputeLinkedBalances` keeps accounts with `bank_account_id` set and a `current_anchor`.
- The export's `dayBalance` is gone: the opening day's stored balance is now the anchor's amount on every account, so `exportedValuations` reads the rows as they are and takes a `Reader`.
- `unlinkBankAccount` no longer rewrites the opening anchor with its day's balance, now its own amount; the gap to the next day becomes a reconciliation there, as any day the forward pass would otherwise move.
- A route test links through `linkBankAccount`, since a route spec may not write `entries` (AD-2).
- Screenshots of the linked account's « Soldes » with the sheet open, light and dark, at 1440 and 390 px, were reviewed against Sure's valuation drawer.

### Review Findings

- [x] [Review][Patch] The start-time recompute kept linked accounts without a bank balance, against the spec [packages/api/src/services/ledger/balances.ts]
- [x] [Review][Patch] AD-8 and `reverseBalances`' comment said the opening day starts at its amount after the anchor too [docs/architecture.md, packages/api/src/domain/balances/reverse.ts]
- [x] [Review][Patch] Unlink still rewrote the opening anchor with its day's balance, and its comment missed the opening anchor as a fixed day [packages/api/src/services/ledger/bank-link.ts]
- [x] [Review][Patch] Two parity statuses lacked their label or story [docs/sure-parity.md]
- [x] [Review][Patch] No liability case for the honoured opening [packages/api/src/domain/balances/reverse.spec.ts]
- [x] [Review][Patch] The e2e test typed the bank's balance by hand and accepted a null day text [packages/app/e2e/bank-connections.spec.ts]
- [x] [Review][Defer] An amount-only edit is refused when a line precedes the opening date [packages/api/src/services/ledger/opening.ts] — deferred: pre-existing on manual accounts, Story 28.20 drops the check.

Rejected:
- A server start halted by an account without an opening anchor (low): AD-8 creates one with every account and never deletes it; every ledger write already joins on it.
- `set_opening_balance` racing a link between its check and the write (low): one household, an assistant's call and a bank link in the same instant.
- `pinnedBy` ignores the bank's anchor (low): only `set_opening_balance` reads it, and it refuses a linked account.
- Existing `reverse.spec.ts` cases given an opening amount equal to the derived one (low): they test derivation; new cases test the gap, the opening day's movements, the anchor's day, after the anchor and a liability.
- A viewer not covered (false): the row's opener depends on `admin` alone, which `viewer.spec.ts` and the route's viewer test cover.
- A file's balance kept against an opening Archant set at link time (low): the same rule as on a manual account, Sure's anchor winning its day.
- An upgrade note for the recomputed history (low): the history moves to Sure's computation with no action asked; the PR says it.
- `gapReader` reads the opening anchor on forward accounts too (low): one primary-key read per page.
- The export change not in the Code Map (low): recorded above.
- Status mismatch between the spec and sprint status (false): both set to done at completion.

## Spec Change Log

## Review Triage Log

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | Start recompute keeps anchorless linked accounts | low | patch | `isNotNull(bankAccountId)` alone; now also requires a `current_anchor`. |
| 2 | AD-8 and comment overstate the after-anchor case | low | patch | The 06 is 99 500 in « ends an opening day after the anchor »; wording now says the day before ends there going backward only. |
| 3 | Unlink rewrites the opening with its own amount | low | patch | The stored opening day equals the anchor's amount now; the update is a no-op. |
| 4 | Parity statuses unlabelled | low | patch | « Editing the opening balance » and « Snapshot on the opening date » rows. |
| 5 | No liability case | low | patch | Added to `reverse.spec.ts`. |
| 6 | E2E literal amount, nullable text | low | patch | `euros(123_456)`, `not.toBeNull()`. |
| 7 | Amount-only edit refused with older lines | medium | defer | `opening.ts` checks any given date; Story 28.20 owns the refusal. |
| 8 | Start halted without an opening anchor | low | reject | AD-8 invariant. |
| 9 | MCP check races a link | low | reject | Negligible window. |
| 10 | `pinnedBy` ignores the bank's anchor | low | reject | Unread for linked accounts. |
| 11 | Adjusted existing tests | low | reject | New cases cover the rule. |
| 12 | Viewer untested | false | reject | Covered by role tests. |
| 13 | File balance kept against Archant's opening | low | reject | Same rule as manual accounts. |
| 14 | No upgrade note | low | reject | PR states it. |
| 15 | Extra query in `gapReader` | low | reject | Negligible. |
| 16 | Export change outside the Code Map | low | reject | Noted in Implementation Notes. |
| 17 | Status mismatch | false | reject | Set together at completion. |

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test && pnpm test:e2e` -- all green, no tracked file changed after.

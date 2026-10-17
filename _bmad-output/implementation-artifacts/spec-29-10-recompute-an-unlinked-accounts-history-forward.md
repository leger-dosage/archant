---
title: "Story 29.10: Recompute an unlinked account's history forward"
type: 'feature'
created: '2026-10-17'
status: 'done'
baseline_commit: '11b8e984b53c4c08957ef84704e2a3b0cbb98d10'
route: 'dispatch'
review_loop_iteration: 2
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-29-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Sure (at `00dd977fb`) computes an account backward only while it is `linked?`: `Account::Syncer#materialize_balances` picks `:reverse` for a linked account and `:forward` otherwise. `AccountsController#unlink` destroys the account's `account_providers` rows and nothing else, so every valuation stays, the bank's last `current_anchor` included, and the next computation runs `Balance::ForwardCalculator`: from the opening anchor, each valuation of any kind setting its own day (`Balance::SyncCache#get_valuation`), the movements adding up in between. A past day the backward pass derived differently takes the forward value. Archant's `unlinkBankAccount` in `services/ledger/bank-link.ts` instead writes a `reconciliation` on every day where going forward would part from the stored backward history, turns the `current_anchor` into one, and so keeps the history frozen; AD-8 says a disconnection keeps it.

**Approach:** `unlinkBankAccount` clears the link, writes no reconciliation, keeps every valuation, the bank's last balance included, and recomputes the account forward from its history start. The bank's last balance keeps its row, id, date and amount; its kind becomes `reconciliation`, the kind Sure's next sync gives a superseded anchor (`preserve_anchor_as_reconciliation_if_stale`), because Archant's forward pass, « Soldes » tab, snapshot writes and opening-balance preview read a manual account's valuations as reconciliations. AD-8 and the parity row « Disconnect » say so.

## Boundaries & Constraints

**Always:**
- `unlinkBankAccount(deps, accountId, options)` clears `bank_account_id` and inserts no entry. The opening anchor keeps its date and amount, every reconciliation stays as it is. The `current_anchor` keeps its id, date and amount, its `valuation_kind` set to `reconciliation` and its `import_id` cleared, as `rotateCurrentAnchor` keeps a superseded anchor; it is deleted instead when the opening anchor or a reconciliation already holds its day, as `rotateCurrentAnchor` does, since Sure keeps one valuation per day (`Entry` `validates :date, uniqueness`). An account that was computed backward (`backwardAnchor` found one before the link is cleared) is recomputed forward from `historyStartOf`, every stored row rewritten, those before the opening date included; one without a bank balance, already forward, only loses its link.
- The forward pass is unchanged: it reads the opening anchor and reconciliations, each setting its own day, as Sure's `Balance::ForwardCalculator`.
- A past day whose forward balance differs from the backward one takes the forward value at the unlink, and keeps it at every later recompute.
- Both callers get it unchanged: `disconnectConnection` (each linked account of the connection, credentials removal included) and `unlinkAccount` (one account, Story 29.8).
- AD-8: the disconnection sentence says the unlink clears the link, writes no reconciliation, keeps every valuation, the bank's last balance as a `reconciliation` on its day, and the account is then computed forward; the **Prevents** line no longer promises an unchanged history on disconnect.
- `docs/sure-parity.md` « Disconnect »: accounts become manual and are computed forward from their valuations, the bank's last balance included, as Sure's `account/syncer.rb`; Parity, Story 29.10.

**Never:** no migration and no recompute of accounts unlinked before this release: the reconciliations their unlink wrote are valuations like any other now, and Sure would keep them. No change to `linkBankAccount`, to the sync's `rotateCurrentAnchor`, to the forward pass, to the « Soldes » tab, or to the interface text. No new dependency.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Unlink | linked checking, lines, bank balance today | link cleared; opening anchor kept; the bank's balance the same row, id, date and amount, kind `reconciliation`; no other entry; balances forward | none |
| Past day differs | opening 1 234,56 €, line −42,91 € on the 10th, bank 1 000 € today | backward 9th ≠ forward 9th; after unlink the 9th reads 1 234,56 €, the 10th 1 191,65 €, today 1 000 € | none |
| Computed again | add a line after the unlink | the forward balances stand, the bank's day still 1 000 € | none |
| Earlier bank figures | reconciliations a sync rotated | each still sets its own day | none |
| Snapshot on the bank's day, before | a user snapshot on the anchor's day while linked | the snapshot kept, the anchor deleted; the snapshot sets the day | none |
| Snapshot on the bank's day, after | user records a snapshot on the bank's day after unlink | the kept row takes the amount, one valuation on the day | none |
| Lines before opening | a line dated before the opening date | the days before the opening start from zero, forward | none |
| Anchor before opening | anchor stored before Story 28.18, dated the day before the opening | that day reads the bank's figure, the opening day the opening amount | none |
| Anchor on opening day | account opened and linked the same day | anchor deleted, the opening amount holds the day | none |
| No bank balance | linked with `balance: null` | only the link goes; balances unchanged | none |
| Disconnect | connection feeding two accounts | both manual, computed forward, the bank's balance kept on each | none |
| Card | linked card, bank owes 300 € | forward with the liability sign; today 300 € owed | none |
| Unknown | unknown id | refused | `NOT_FOUND` |

</frozen-after-approval>

## Code Map

- `packages/api/src/services/ledger/bank-link.ts` -- `unlinkBankAccount` simplified; `unlinkReconciliations` deleted; the anchor kept as a reconciliation, or deleted where a valuation holds its day.
- `packages/api/src/services/ledger/bank-link.spec.ts` -- `describe("unlinkBankAccount")` rewritten to the forward behaviour.
- `packages/api/src/services/bank-connections.spec.ts` -- `disconnectConnection` and `unlinkAccount` tests: valuations kept, forward balances.
- Docs: `docs/architecture.md` AD-8; `docs/sure-parity.md` « Disconnect ».
- Sure, read-only, at `00dd977fb`: `app/models/account/syncer.rb`, `app/models/balance/forward_calculator.rb`, `app/models/balance/base_calculator.rb`, `app/models/balance/sync_cache.rb`, `app/controllers/accounts_controller.rb#unlink`, `app/models/entry.rb` (valuation uniqueness).

## Tasks & Acceptance

**Execution:**
- [x] Vitest first, failing: unlink keeps the opening anchor's amount and the bank's balance row as a reconciliation, inserting no entry; a past day takes its forward value; lines before the opening date go forward from zero; a later write keeps the forward balances; earlier bank reconciliations still set their days; a snapshot on the anchor's day, before and after the unlink; the anchor before and on the opening day; the card; an account without a bank balance; disconnection of two accounts and the one-account unlink in `bank-connections.spec.ts`.
- [x] `bank-link.ts`: `unlinkBankAccount` clears the link, keeps the anchor as a reconciliation and recomputes forward; `unlinkReconciliations` removed.
- [x] AD-8 and the parity row.
- [x] Full gate.

**Acceptance Criteria:**
- Given a linked account computed backward from its bank balance, when its bank is disconnected or the account is unlinked, then `unlinkBankAccount` writes no reconciliation and leaves the opening balance's amount, and the account is computed forward from its opening balance and each valuation the bank left, its last balance included, setting its own day.
- Given a past day whose forward balance differs from the backward one, when the account is computed again, then the forward balance stands.
- Given AD-8, then it says a disconnection no longer keeps the stored history.
- Given the finished story, when `pnpm test` and `pnpm test:e2e` run, then Vitest covers a disconnection and an unlink, the valuations kept and the forward balances, and no request reaches Enable Banking.

### Review Findings

Second pass, `bmad-code-review` (four layers) over the committed branch.

- [x] [Review][Patch] The `!linked` guard had no test reaching it: the account without a bank held no anchor either [packages/api/src/services/ledger/bank-link.spec.ts]
- [x] [Review][Patch] The service tests' sampled days did not show they read forward; each now checks the day before the line differs before the unlink [packages/api/src/services/bank-connections.spec.ts]
- [x] [Review][Patch] The disconnect test's title still said the history is kept [packages/api/src/services/bank-connections.spec.ts]
- [x] [Review][Patch] AD-8 said every valuation stays, then that the anchor may go; it now names the exception in the same clause [docs/architecture.md]
- [x] [Review][Patch] The card test did not check the kept figure's stored sign [packages/api/src/services/ledger/bank-link.spec.ts]
- [x] [Review][Defer] An unlink then a relink on the bank figure's own day leaves a `reconciliation` and a new `current_anchor` on one day [packages/api/src/services/ledger/bank-link.ts] — deferred: pre-existing, the former unlink wrote the same reconciliation on that day and `linkBankAccount` never looked for one

Rejected:
- `low` The disconnect dialog says « Ses transactions et son historique sont conservés »: transactions and valuations are kept, and Sure's own unlink warning says its balances are kept while it recomputes forward.
- `low` No troubleshooting entry or release note for balances moving at a disconnect: the pull request says it, and no upgrade step is needed.
- `low` No unlink test for an investment, crypto or non-cash account: the unlink adds nothing type-specific; their forward pass has its own tests.
- `low` The unlink reads the anchor with its own query rather than `backwardAnchor`: one anchor per account is guaranteed by `writeCurrentAnchor`, and the guard on the link is tested.
- `low` `rotateCurrentAnchor` now calls the extracted `retireCurrentAnchor`: a refactor with the same behaviour, its sync tests unchanged and green.
- `low` The parity row says « Different » for the stored kind beside the story's Parity: the balances match Sure, the storage kind is the admitted difference.
- `low` A `current_anchor` dated after today after a time zone change would be kept as a future snapshot: the sync's own rotation has the same edge, and no release moves `APP_TIMEZONE` under a live anchor.
- `low` An anchor stored before Story 28.18, dated before the opening, is kept as a reconciliation before it: the former unlink kept it the same way.
- `low` Accounts unlinked by an earlier release keep the reconciliations that froze their history: Sure would keep those valuations too, and the spec leaves them on purpose.
- `low` The `retired` helper duplicates an inline map, and `dayOf` returns `undefined` for a missing day: two test files, and a missing day fails the comparison.
- `false` Sprint status `review` while the spec reads `done`: both read `done` at the workflow's end, in this pull request.
- `false` A stray anchor on an account already manual stays: no path writes one, and the guard leaves the account untouched as before.

## Design Notes

Assumptions taken alone, each settled by Sure. The bank's last balance keeps its row but turns `reconciliation`: Sure's unlink leaves a `current_anchor` that its forward pass reads like any valuation and its activity feed shows and edits; Archant's « Soldes » tab, `recordSnapshot`, `deleteSnapshot` and the opening preview's `pinnedBy` read a manual account's valuations as reconciliations, so keeping the kind would leave a figure that fixes a day yet cannot be seen, edited or deleted. The kind is the one Sure's own `preserve_anchor_as_reconciliation_if_stale` gives the same row once superseded, and no reconciliation row is written. Where the opening anchor or a snapshot already holds the bank's day, the anchor goes, as `rotateCurrentAnchor` does: Sure keeps one valuation per day, and the opening day keeps the opening amount. Accounts unlinked before this release keep the reconciliations their unlink wrote: they are valuations, which Sure keeps. No interface file changes, so no screenshot: the balances an unlinked account shows change, its screens do not.

## Spec Change Log

- Review loop 1 (step-04, three layers). Trigger: the kept `current_anchor` fixed a day on a manual account that the « Soldes » tab, `recordSnapshot` (a second valuation on the same day), `deleteSnapshot` and `setOpeningBalance`'s `pinnedBy` all ignored, so the user could neither see nor correct it, and the opening preview reported a change the anchor cancelled. Amended: Intent approach, Always, Never and the matrix; the anchor keeps its row as a `reconciliation`, or goes where a valuation holds its day; the forward pass stays as it was, so no per-day precedence. Known-bad state avoided: an invisible valuation that fixes a balance, and two valuations on one day. KEEP: no reconciliation inserted; recompute forward from `historyStartOf`; the opening anchor untouched; `unlinkReconciliations` deleted; the rewritten `describe("unlinkBankAccount")` scenarios (past day forward, later write, card, chain of bank figures, anchor before the opening, no bank balance); the `bank-connections.spec.ts` disconnect and unlink assertions; AD-8 Prevents wording and the parity row.

## Review Triage Log

Loop 1, `bmad-build` step 4 (blind, edge-case, verification-gap layers), over the first derivation, which kept the `current_anchor` as such and ranked same-day valuations in the forward pass.

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | A snapshot recorded on the kept anchor's day adds a second valuation where Sure updates the one there; deleting it brings the bank's figure back | medium | bad_spec | `recordSnapshot` looks up reconciliations only (`snapshotOn`). Re-derived: the anchor is kept as a `reconciliation`, which `recordSnapshot` updates in place; tested. |
| 2 | The kept anchor fixes a day on a manual account that « Soldes » never lists and no route edits or deletes | medium | bad_spec | `listSnapshots`, `snapshotRow` read `reconciliation` only. Re-derived as above. |
| 3 | The opening sheet refuses the kept anchor's day as `SNAPSHOT_EXISTS` while « Soldes » shows nothing there | low | bad_spec | Same root cause; the day now holds a listed snapshot. |
| 4 | `setOpeningBalance`'s `pinnedBy` ignores the kept anchor, so the assistant's preview reports a change the anchor cancels | medium | bad_spec | `opening.ts` reads reconciliations only for `pinnedBy`. Re-derived: the kept figure is a reconciliation. |
| 5 | A relink deletes the kept anchor, the day it fixed jumping | medium | bad_spec | `linkBankAccount` deletes every `current_anchor`. Re-derived: an unlinked account holds none, its figure is a reconciliation a relink keeps, as Sure's next sync would. |
| 6 | The forward pass reading `current_anchor` changes every manual account still holding one, without migration | low | bad_spec | Only an account whose connection row vanished without the ledger holds one. Re-derived: the forward pass is unchanged. |
| 7 | The claim « a snapshot on the anchor's day wins, as Sure's `ReconciliationManager` » overstated, both rows stayed | medium | bad_spec | Same root cause as 1. |
| 8 | Same-day precedence untested for opening anchor against reconciliation; `valuationPerDay` takes a bare `number` for money | low | bad_spec | Moot: the precedence is gone with the re-derivation. |
| 9 | No test unlinks an account with lines before the opening date, so recomputing from the opening date instead of `historyStartOf` passes | low | patch | Added « computes the days before the opening forward, from zero before the oldest line ». |
| 10 | The disconnect test indexes `kept[0]` while finding the checking account by id | low | patch | Indexed by `accountIds.indexOf(checkingAccount)`. |
| 11 | No test for a snapshot already on the bank's day at the unlink | low | patch | Added « keeps a snapshot already on the bank's day, the bank's figure dropped ». |
| 12 | The pending line dated on the bank's day was dropped from the pending test | low | patch | Restored `p-2`. |
| 13 | The disconnect dialog and Sure's unlink warnings still say the history and balances are kept | low | reject | Sure's own unlink dialog says « Toutes les transactions et soldes existants seront conservés » while it recomputes forward; transactions and valuations are kept. |
| 14 | `last_updated` went back in time; sprint status `in-progress` while the spec read `in-review` | false | reject | `last_updated` is the clock's time; both statuses move to `done` together at the workflow's end. |
| 15 | The valuations helper orders ties by date only, two rows on one day comparing at random | false | reject | After the re-derivation an unlinked account never holds two valuations on one day. |

Loop 2, the same three layers over the re-derived code.

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 16 | The unlink's own anchor read drops `backwardAnchor`'s linked filter, so an account already manual holding a stray anchor would be converted and recomputed | low | patch | Returns early unless `bank_account_id` is set; « leaves an account no bank feeds as it is » covers it. |
| 17 | Several `current_anchor` rows on one account would leave the extra ones | false | reject | `writeCurrentAnchor` deletes every anchor before inserting one; no path writes two. |
| 18 | No test relinks after an unlink, so the claim that the kept figure survives a relink is unproven | low | patch | Added « keeps the bank's former balance when the account is linked again ». |
| 19 | The disconnect test's `other ?? ""` would compare two empty histories if the fixture lost an account | low | patch | Throws when the fixture has no second account. |
| 20 | The parity row says Parity while the storage kind differs from Sure | low | patch | Now « Different: » with the reason, the balances the same. |
| 21 | `writeCurrentAnchor`'s and `retireCurrentAnchor`'s comments said « keep it » and « snapshot » where the anchor may go and a file's balance counts | low | patch | Reworded. |
| 22 | AD-8's new sentence tied the conversion to Sure's activity feed without saying Sure converts nothing, nor that the stored history is not kept | low | patch | Reworded: Sure leaves a `current_anchor`; Archant's readers read reconciliations; « The stored history is not kept ». |
| 23 | The disconnect dialog's « Ses transactions et son historique sont conservés » and the credentials removal text promise an unchanged history | low | reject | Transactions and valuations are kept; Sure's own unlink warning says « Toutes les transactions et soldes existants seront conservés » while it recomputes forward. Interface text is out of the story. |
| 24 | The service tests' sampled days read the same forward and backward | low | reject | They prove the wiring (link cleared, valuations kept, forward recompute) on the fixture; `bank-link.spec.ts` covers the days where the two part, through the same `unlinkBankAccount`. |
| 25 | No unlink test for an investment, crypto or non-cash account | low | reject | The unlink only converts the anchor and calls `recomputeBalances`, whose forward pass for those types has its own tests. |
| 26 | Days before the opening date now read negative after an unlink | false | reject | Sure's `opening_starting_balances` seeds zero before the opening anchor; the matrix asks for it. |
| 27 | No self-hoster note on balances changing at a disconnect | low | reject | The pull request says it; no upgrade step is needed, past unlinks are untouched. |
| 28 | Spec Verification says green while « Full gate » is unchecked; `last_updated` went back | false | reject | Both are settled at completion; `last_updated` is the clock's. |
| 29 | `retired` duplicates an inline map in `bank-link.spec.ts`; `dayOf` returns `undefined` silently | low | reject | Two test files, two lines each; a missing day fails the `toBe` comparison anyway. |
| 30 | Deleting the anchor on the opening day or under a reconciliation contradicts « every valuation stays » | false | reject | The Always clause and the matrix name both deletions; Sure keeps one valuation per day. |
| 31 | Computing from `historyStartOf` rather than the opening balance contradicts the AC | false | reject | Sure's `calculation_start_date` is the oldest entry or the opening anchor, whichever is first. |
| 32 | The `retired` helper would fail on a fixture whose anchor shares a day with a snapshot | low | reject | Fixture-specific: this fixture has none, and the assertion would then fail loudly. |

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test && pnpm test:e2e` -- all green, no tracked file changed after.

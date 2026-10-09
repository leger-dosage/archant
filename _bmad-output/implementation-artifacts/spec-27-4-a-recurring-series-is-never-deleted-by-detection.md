---
title: 'Story 27.4: A recurring series is never deleted by detection'
type: 'bugfix'
created: '2026-10-09'
status: 'done'
baseline_commit: 'cf7c35b3d983a75b0acc00dae12609466e5987bd'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-27-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** When detection re-keys a series onto a key another stored series already holds, `rekey` deletes one of them: the moving series when the holder is not `suggested`, the `suggested` holder otherwise. The cascade on `recurring_occurrences`, `recurring_allocations` and `recurring_price_changes` takes the history with it, so a bill the owner declared, with its payments, disappears after a rename. Sure has no re-key: its `Identifier` never deletes a series.

**Approach:** `rekey` keeps its move but never deletes. When the new key has a holder, nothing happens: both series stay, the moving one on its old key with its occurrences, payments and price changes. Sure's `Cleaner`, already ported as `cleanerSteps`, retires it once no transaction of its old key comes.

## Boundaries & Constraints

**Always:**
- `rekey` emits only moves; `RekeyStep` loses its `delete` variant. A holder of any status, `suggested` included, blocks the move; the holder is the same match as today (account, amount, currency, `dedupScope`, key), so a holder of another amount, account, currency or scope still lets the series move.
- A move without a holder is unchanged, as are the guards before it: a bill with no payment yet never moves, a row of the window still on the old key keeps it, two target keys on the last day keep it.
- `detectWithin` applies moves only; its « a move may take a key a delete just freed » comment goes.
- Retirement is `cleanerSteps` as it stands, which matches Sure's `staleness_threshold_date` at `7e1d93613`: the earlier of two of the series' cycles and two calendar months back, six for a manual series. A declared monthly bill therefore turns `inactive` six months after its last payment, a detected monthly series about two months after.
- `docs/sure-parity.md` « Renamed series » reads Parity, Story 27.4: an item follows its latest row's new key when no other series holds it, and detection never deletes a series.

**Never:** no move onto the key under a new `dedupScope` (it would bring back the twin `rekey` exists to prevent); no merge of occurrences or payments into the holder; no change to `cleanerSteps`, `staleBefore`, `refreshSeries` or the deletion of empty suggestions (Archant's suggestions hold no payment); no migration.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Declared bill renamed onto a suggestion's key | manual `active` bill with payments; rows renamed; `suggested` series on the new key | both kept; bill on its old key with occurrences, allocations and price changes; suggestion claimed by the pattern | none |
| Same, six months on | no row of the old key since | bill `inactive`, history intact; not `inactive` the day before the threshold | none |
| Active detected series onto an `active` holder | rows renamed | both kept, no step; the old one `inactive` after two monthly cycles | none |
| No holder | rows renamed | moves as today | none |
| Holder of another amount, account, currency or scope | rows renamed | moves as today | none |

</frozen-after-approval>

## Code Map

- `packages/api/src/domain/recurring/series.ts:162-253` -- `RekeyStep`, `rekey`: drop both `delete` pushes; `continue` when `holder !== undefined`; rewrite the doc comment (« gives way », « the moving row goes » are gone).
- `packages/api/src/services/recurring/series.ts:239-279` -- `detectWithin` doc comment and the `oneByOne` over `rekeyed.steps`: update only.
- `packages/api/src/domain/recurring/series.spec.ts:183-212` -- the two holder tests become « keeps both » tests with `steps: []`.
- `packages/api/src/services/recurring/series.spec.ts:1308-1323` -- « drops a suggested twin » becomes « keeps a suggested twin and the active series »; helpers `rename`, `detectedBill`, `setStatus`, `stored`, and `vi.setSystemTime` (line 45) to move the clock.
- `packages/api/src/services/recurring/bills.ts:196` -- `declareBill`, and `services/recurring/payments.ts:577` `addPayment`, to build the declared bill with payments.
- `packages/api/src/domain/recurring/series.ts:345-395` -- `staleBefore`, `cleanerSteps`: read only.
- `docs/sure-parity.md:209` -- « Renamed series ».

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/domain/recurring/series.spec.ts` -- failing first: a `suggested` holder and an `active` holder each give `steps: []` and `stored` unchanged; the « another amount, account, currency or scope » test still moves.
- [x] `packages/api/src/services/recurring/series.spec.ts` -- failing first: a bill declared with `declareBill`, its rows paid through `addPayment`, renamed onto a key a `suggested` series holds; after `runRecurring` both series exist and the bill's occurrences, allocations and price changes count as before; with the clock one day before the six-month threshold it is still `active`, after it `inactive`. Rewrite the test at `:1308` to keep both.
- [x] `packages/api/src/domain/recurring/series.ts` -- `rekey` and `RekeyStep` as the Code Map says.
- [x] `packages/api/src/services/recurring/series.ts` -- `detectWithin` as the Code Map says.
- [x] `docs/sure-parity.md` -- the « Renamed series » row.

**Acceptance Criteria:**
- Given the finished story, when `pnpm test` runs, then both Vitest projects pass and no spec asserts a `delete` step from `rekey`.

## Design Notes

The epic's acceptance criterion says « inactive after two cycles ». That holds for a detected series; for a declared (manual) monthly bill Sure's threshold is six months, since `staleness_threshold_date` takes the earlier of the two dates. The spec follows Sure; the test pins six months. Until then the old bill keeps its open occurrences and reads overdue, as in Sure, where a renamed merchant leaves the old series in place the same way.

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck` -- expected: clean.
- `pnpm test` -- expected: both Vitest projects pass.

## Implementation Notes

- `RekeyStep` lost its `kind` too: with one variant nothing read it.
- `rekey` iterates `stored`; `current` still carries earlier moves, so a key one series leaves is free for the next in the same pass, and `detectWithin` keeps applying moves in order.
- « Renamed series » reads Different, not Parity: Archant still moves a series onto a free key, where Sure leaves a twin.
- The service test pays the declared bill through `runRecurring`'s matcher with `backfill: true` rather than `addPayment`: the bill is declared from the first row, and the matcher allocates all three. It inserts one price change to pin that one too.
- Local `pnpm test`: the `volume` project's « assistant's first page … under 150 ms » timed out on two of three runs under a load average near 20; it reads transactions, not recurring series. `pnpm test:e2e` not run locally: no interface change, CI runs it.

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Evidence | Route |
|---|---|---|---|
| Comment on move order removed from `detectWithin` | low | Real: a move may still take a key an earlier move freed. | patch: comment restored for moves |
| `RekeyStep.kind` is a one-variant discriminant | low | Real: nothing reads it. | patch: removed |
| Parity row repeats « never deletes » and the Sure column | low | Real. | patch: Different names Archant's move |
| No test of two series renamed onto one key in a pass | medium | Real: `current.some` → `stored.some` would pass every test and the second UPDATE would hit the unique index. | patch: domain test |
| Service test does not count price changes, nor the suggestion's status | low | Real gaps against the matrix. | patch |
| `describe` « keeps a renamed series single » contradicts its tests | low | Real. | patch: renamed |
| Loop comment describes mechanism | low | Real. | patch: says why `stored` is safe |
| Payments built through the matcher, not `addPayment` | low | Same allocations; noted above. | rejected |
| Suggestion could take allocations from the bill's rows | false | Occurrences exist only for active series (`occurrences.ts:75,231`); a suggestion has none. | rejected |
| No service test of a detected series retired after two cycles | low | `cleanerSteps` tests pin the threshold; `rekey` keeps it in place. | rejected |
| A held detected series refreshed to count 0 never follows its key later | low | It stays and goes inactive, the outcome the spec asks for as Sure's. | rejected |
| Old declared bill reads overdue until retired; late move after the suggestion goes, untested | low | Sure's behaviour; spec Design Notes. | rejected |
| `epics.md` still says « two cycles » | low | Fix edits planning; the spec's Design Notes record Sure's threshold. | rejected |
| Spec `in-review` while sprint status `in-progress` | false | Completion syncs both. | rejected |

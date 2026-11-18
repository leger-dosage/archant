---
title: 'Story 11.2: Transfer matching ignores excluded transactions and inactive accounts'
type: 'bugfix'
created: '2026-09-25'
status: 'done'
baseline_commit: '32eae03458a72239a1b164a738f1681e30a8cd6f'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-11-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The transfer candidate search takes excluded transactions and transactions of deactivated accounts. Such a row can be offered in « Rapprocher un virement », raise « Virement possible », be linked automatically, or sit as a second candidate that breaks the mutual uniqueness of a real pair, which then stays unlinked.

**Approach:** Add both conditions to the one candidate search every caller shares, on both sides of the pair, as Sure's `Family::AutoTransferMatchable` requires `excluded = FALSE` and an account in `draft` or `active` on the inflow and the outflow.

## Boundaries & Constraints

**Always:**
- A side is a candidate only when `transactions.excluded` is false and `accounts.active` is true. Both sides: an excluded row, or a row of an inactive account, has no candidates either, so its picker shows the existing empty state and it never gets « Virement possible ».
- `isTransferCandidate` stays the last word: `TransferSide` gains `excluded` and `accountActive`, and the SQL prefilter (`candidateOf` or `candidatePairQuery`) mirrors them, so the picker, `matchTransfer`'s re-check, step 6 of `ingest`, `applyRulePlanToHistory` and `suggestedAmong` cannot disagree.
- A rule that excludes a row at step 5 of `ingest` runs before step 6, so that row is not matched.
- `domain/**` and `services/ledger.ts` stay at 100 % branches; no test reaches the network.

**Never:** no unlinking of an existing transfer when a side is excluded or its account deactivated (Sure keeps it); no re-matching when a row is included again or an account reactivated (matching runs on new rows and rule-marked rows only, as today; the picker still offers the pair); no change to the empty-state text `transactions.transfer.noCandidate`; no migration; no pending-row filter; nothing else from the « No decision recorded » rows of `docs/sure-parity.md`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Excluded candidate | outflow on checking, excluded inflow on livret | picker empty, no link, no suggestion | — |
| Excluded source | excluded outflow, plain inflow | outflow's picker empty; inflow's picker empty | — |
| Inactive account | inflow on a deactivated account | not offered, not linked, not counted for a suggestion | — |
| Real pair beside an excluded twin | outflow, inflow on livret, excluded inflow on card, same amount and window | real pair linked automatically, no suggestion | — |
| Real pair beside an inactive twin | same, the twin on a deactivated account | real pair linked | — |
| Manual match forced | `POST` match with an excluded or inactive counterpart | refused | `VALIDATION_ERROR` on `counterpartId`, `not_a_candidate` |
| Already linked, then excluded | transfer exists, one side excluded | transfer kept | — |

</frozen-after-approval>

## Code Map

- `packages/api/src/domain/transfer-matching.ts:18-47` -- `TransferSide` and `isTransferCandidate`; add the two fields and checks, update its doc comment.
- `packages/api/src/domain/transfer-matching.spec.ts:16-70` -- `side()` factory; add `excluded: false, accountActive: true`, and one refusal case per field on either side.
- `packages/api/src/services/ledger.ts:3022-3046` -- `candidateOf`, the SQL prefilter; its doc comment names every caller.
- `packages/api/src/services/ledger.ts:3048-3070` -- `sideColumns` and `transferSide`; already join `transactions` and `accounts`, add `excluded` and `accountActive`.
- `packages/api/src/services/ledger.ts:3084-3120` -- `candidatePairQuery`; joins `sourceAccount`, `sourceTransaction`, `transactions`, `accounts`, so both sides' columns are in scope here. Add them to the `source` select too.
- `packages/api/src/services/ledger.ts:3177, 3238, 3280, 3631` -- `matchNewTransfers`, `transferCandidates`, `matchTransfer`, `suggestedAmong`: callers, unchanged.
- `packages/api/src/services/ledger.spec.ts:4035, 4107, 4628` -- `transferCandidates`, `matchTransfer`, `automatic transfer matching` suites; helpers `openHousehold`, `add`, `updateTransaction`, `transferRows`, `suggested`. Deactivate through `services/accounts.ts` `updateAccount` with `{ active: false }`.
- `packages/web/e2e/transfers.spec.ts:71` -- picker test to copy; `fixtures.ts:216` `api.excludeTransaction`; `keyboard.spec.ts:123` deactivates with `PATCH /api/accounts/:id { active: false }`.
- `_bmad-output/planning-artifacts/architecture/architecture-archant-2026-09-21/ARCHITECTURE-SPINE.md:152` -- AD-11 candidate list.
- `docs/sure-parity.md:150` -- « Excluded rows, inactive accounts » row.

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/domain/transfer-matching.spec.ts` -- tests first: an excluded side and an inactive-account side are refused, whichever side.
- [x] `packages/api/src/services/ledger.spec.ts` -- tests first: every API row of the matrix, including mutual uniqueness restored by an excluded twin and by an inactive twin, and `transferSuggested` false for both sides.
- [x] `packages/api/src/domain/transfer-matching.ts` -- the two fields and checks.
- [x] `packages/api/src/services/ledger.ts` -- select the columns for both sides and add the SQL conditions; update the `candidateOf` doc comment.
- [x] `packages/web/e2e/transfers.spec.ts` -- an excluded row and a row of a deactivated account, both of the opposite amount within four days, are not listed in « Opérations candidates »; with one real inflow and an excluded twin, the outflow row shows the other account's name and no « Virement possible ».
- [x] `ARCHITECTURE-SPINE.md` AD-11 -- add « neither side excluded, both accounts active » to the candidate rule.
- [x] `docs/sure-parity.md:150` -- Archant column « Never candidates. », decision « Parity. Spec 11.2. ».

**Acceptance Criteria:**
- Given the finished story, when `pnpm test` and `pnpm test:e2e` run, then every matrix row has an automated test: Playwright for what the interface shows, Vitest for the rest.

## Implementation Notes

- The SQL conditions live in `matchableSide`, applied to both sides in `candidatePairQuery`'s `where`: `candidateOf` is a join condition on `entries`, where `transactions` and `accounts` are not joined yet.
- `packages/web/e2e/fixtures.ts` gained `api.deactivateAccount`.
- Removing the fix makes 8 new Vitest tests and both new Playwright tests fail; the kept-transfer test passes either way, as intended.

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Evidence | Route |
|---|---|---|---|
| Spec `in-review` while sprint-status says `in-progress` | false | Sprint status moves at the presentation step, by design. | rejected |
| `matchTransfer` doc comment omits excluded and inactive counterparts | low | Comment lists refusals and now misses two. | patch |
| `candidatePairs` doc says only `candidateOf` narrows in SQL | low | `matchableSide` also narrows in `candidatePairQuery`. | patch |
| Excluded source reports the error on `counterpartId` | low | Same as a source already in a transfer since Spec 5.1; the picker never offers such a pair. | rejected |
| No test through `applyRulePlanToHistory` | low | Same `candidatePairs` call covered by every other test; no new branch. | rejected |
| No test that re-inclusion does not re-match | false | A « Never » item, not a behaviour the change adds. | rejected |
| Kept-transfer test mixes both triggers | low | Both are asserted to keep; splitting adds no coverage of new code. | rejected |
| « Excluded source » row has no Playwright test (both blind and edge-case layers) | medium | Acceptance asks Playwright for what the interface shows; only Vitest covers it. | patch |
| Inactive-twin test skips `suggested(inflow)`; excluded-source test refuses one way | low | Asymmetric with the sibling tests. | patch |
| Empty-state text misleads on an excluded row | low | The intent keeps `transactions.transfer.noCandidate` unchanged. | rejected |
| Parity row silent on kept transfers | low | A spec decision worth recording beside the parity. | patch |
| Code Map line numbers drift | low | Fix edits this spec. | rejected |

## Design Notes

Sure filters both sides, so an excluded source finds nothing either. Keeping the check in `isTransferCandidate` as well as in SQL follows how the window and `inTransfer` are already done: SQL narrows, the domain decides, and the domain test pins the rule at 100 % branches.

## Verification

**Commands:**
- `pnpm typecheck && pnpm lint:code && pnpm test` -- expected: green, `domain/**` and ledger at 100 % branches.
- `pnpm test:e2e` -- expected: green.

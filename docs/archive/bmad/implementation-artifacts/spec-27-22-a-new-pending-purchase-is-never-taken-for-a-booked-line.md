---
title: "Story 27.22: A new pending purchase is never taken for a booked line"
type: 'bugfix'
created: '2026-10-12'
status: 'done'
baseline_commit: 'bfda837f296921bc6ad57c3296e75f56bef47987'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-27-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A sync's pending line whose `entry_reference` the ledger does not know, but whose fingerprint names a booked entry, is grouped `present` on that entry, so a second identical purchase never counts. Once it is created, its booked version can meet the same fate: booked lines are looked up by fingerprint before their reference, so a booked twin listed first is taken for the older entry and the new pending entry is deleted after two missed days. Sure keys every bank line by `compute_external_id` (`transaction_id`, else `entry_reference`, else content) and never matches a provider entry by content (`find_duplicate_transaction` keeps `external_id: nil`). Sure read at `afdac0a8c`.

**Approach:** In `groupLines`, a pending line with an unknown reference is created beside the booked entry its fingerprint names, the fingerprint left with that entry, as already done beside a pending entry; and every line is looked up by its reference first, its fingerprint second.

## Boundaries & Constraints

**Always:**
- A pending line left over by `assignIdentical` whose fingerprint names an entry is `present` on it only when the line has no `ext:` key; with one, it is `created` and in `sharing`, so `attachKeys(..., { keepExisting: true })` gives it its `ext:` key and leaves the fingerprint where it is.
- A booked line's hit is `byExternal ?? known.get(fingerprint)`: a known reference wins; an unknown or absent one falls back to the fingerprint, as today. A reference hit on a pending entry still absorbs, and `booked` still keeps a second line from absorbing an entry this statement booked.
- AD-7's key formulas, `withoutRepeats`, `withoutSettledPending` and step 3's 5-day amount match stay as they are.

**Never:** no change to the connector, the schema or a migration; no rekeying of stored entries; no interface change; no `transaction_id` key (AD-18).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| New purchase, reference | E1 booked, `ext:r1`, holds `fp0` of triple T; sync `[PDNG r9 T, BOOK r1 T]` | `PDNG` created as E2 with `ext:r9` only; `BOOK` present on E1; E1 keeps `fp0`; 2 entries | none |
| Next sync, same lines | then the same statement | `PDNG r9` refreshes E2, nothing created, E2 `missed: 0` | none |
| Its booked version listed first | then `[BOOK r9 T, BOOK r1 T]` | `BOOK r9` books E2 in place, `BOOK r1` present on E1; 2 entries, both booked | none |
| No reference | E1 as above; sync `[twin T]` (`externalId: null`) | present on E1, nothing created | none |
| Booked entry without reference | E1 booked from a line without reference, triple T; sync `[PDNG r9 T]` | created beside E1, as Sure's distinct `external_id` | none |
| Pending beside pending | existing 11.5 tests in `pending.spec.ts` « identical pending lines » | unchanged | none |

</frozen-after-approval>

## Code Map

- `packages/api/src/services/ledger/ingest.ts:340` -- `hit` in `groupLines`' key loop: booked lines read `known.get(fingerprint) ?? byExternal`; swap to reference first.
- `packages/api/src/services/ledger/ingest.ts:405-426` -- the `named` branch after `assignIdentical`: drop `!named.pending ||` so only a line without `ext:` is `present`; the `sharing` comment and `groupLines`' doc comment (`:289-302`) follow.
- `packages/api/src/services/ledger/ingest.ts:916-931` -- `sharing` rows written with `keepExisting`; reuse, no change.
- `packages/api/src/services/ledger/entry-keys.ts:18` -- `entriesByKey` returns `{ entryId, pending }` per key, scoped to the account and source.
- `packages/api/src/services/ledger/pending.spec.ts:634-812` -- « identical pending lines »; helpers `pendingLine`, `bookedLine`, `twin`, `settled`, `createdBySync`, `rowOf`, `keysOf`, `transactionCount` from `testing/ledger.ts:692-742`. `bookedLine` and `pendingLine` must share date and label to share a triple: pass `label` and `date` overrides.
- `docs/architecture.md:189` -- AD-17: « A booked line is looked up by its fingerprint, then its `ext:` key » becomes reference first; add the pending-beside-booked rule.
- `_bmad-output/implementation-artifacts/deferred-work.md:63-66` -- add `resolved: Story 27.22.` to the spec-11-5 entry.

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/services/ledger/pending.spec.ts` -- first: one test per matrix row from « New purchase, reference » to « Booked entry without reference », asserting `created`, `groups.present`, `rowOf` and `keysOf` (E2 holds no `fp:` key, E1 still holds `fp0`); watch the first and third fail.
- [x] `packages/api/src/services/ledger/ingest.ts` -- the two changes above, comments updated.
- [x] `docs/architecture.md` -- AD-17 as in the Code Map.
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- mark the entry resolved.

**Acceptance Criteria:**
- Given the whole `services/ledger` suite, when it runs, then every existing test passes unchanged and the ledger keeps its branch coverage threshold.

## Design Notes

The booked-side swap goes beyond the story's text, but without it the purchase the story creates is lost again when it books: in `[BOOK r9 T, BOOK r1 T]` the first line takes index 0, whose fingerprint E1 holds. Reference first is Sure's order, so the epic's rule settles it. A booked line whose reference and fingerprint name two different entries is the only case that changes; for a file import that moves which entry a `present` line names, never a count.

## Verification

**Commands:**
- `pnpm --filter @archant/api exec vitest run src/services/ledger src/services/sync.spec.ts` -- expected: pass.
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test` -- expected: all green.

## Implementation Notes

- The pending-side change alone left « Its booked version listed first » failing, as the Design Notes predicted; the reference-first booked lookup closed it. Mutating either change back fails the new tests.
- A sync result exposes no `absorbed` group, so the refresh test proves the refresh by the notes the line brings.
- After review: tests compare E1's keys exactly (`ext:r1` and its fingerprint) and E2's after booking; `purchase` in `pending.spec.ts` names why its label is `BOULANGERIE`.

## Spec Change Log

## Review Triage Log

| # | Source | Finding | Verdict | Evidence | Route |
|---|--------|---------|---------|----------|-------|
| 1 | blind, edge | A booked line with an unknown reference whose fingerprint names a booked entry holding another reference is `present` on it, so an identical purchase listed booked at once, or booked under a new `entry_reference`, is lost | medium | Real: `byExternal ?? known.get(fingerprint)` falls back to content. Pre-existing, and the frozen intent keeps the fingerprint fallback for booked lines; skipping it needs to know whether the named entry holds an `ext:` key, which `entriesByKey` does not return, and must keep a file re-export with new `FITID`s recognised | defer |
| 2 | edge | Two booked lines of one statement sharing an `entry_reference` both land on the first's entry | low | AD-18 takes `entry_reference` as unique per line; a bank repeating it for two lines is not a case met in use | reject |
| 3 | blind, spec | Tests check E1's keys by count, not by value, and nothing after booking | low | `toHaveLength(2)` holds with any second key | patch |
| 4 | spec | The refresh test asserts `missed: 0`, already true after creation | low | Proves nothing about the refresh | patch |
| 5 | blind | A file preview taken before the upgrade fails its confirm when a `present` line now names another entry | low | `previewDigest` holds the `entryId`; only when a reference and a fingerprint name two entries, previews expire in 24 hours and the failure is a loud `IMPORT_PREVIEW_STALE` | reject |
| 6 | blind, standards, gap | Sprint status `ready-for-dev` while the code ships | false | Both files move to `done` at the end of the review | reject |
| 7 | blind, standards | The `groupLines` comment leaves a short line | low | Direct correction | patch |
| 8 | standards | The Sure reason appears in the doc comment and again inline | low | Direct deletion | patch |
| 9 | standards | `"BOULANGERIE"` reads as arbitrary in three tests | low | Its role, sharing `bookedLine`'s fingerprint, was unwritten | patch |
| 10 | blind | The epic says the line is created « sharing its fingerprint », the code leaves the key with E1 | false | The frozen intent says the fingerprint stays with that entry; `entry_keys` holds a key once per source | reject |
| 11 | blind | AD-17's « left over » is undefined | false | AD-17 already uses it for lines its group placed on no entry, two sentences earlier | reject |
| 12 | blind | E2 holds no fingerprint, so if the bank drops its reference the line falls to E1 | low | A bank dropping a reference it sent is not a case met in use; Sure would also create a new entry | reject |


---
title: "Story 33.3: Leave a renamed series behind"
type: 'feature'
created: '2026-10-28'
status: 'done'
baseline_commit: '13234e43eb5e653c86ed08021c4d53daa062fb98'
route: 'dispatch'
review_loop_iteration: 0
context: ['{project-root}/_bmad-output/implementation-artifacts/epic-33-context.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Sure (`00dd977fb`) keys a series on its merchant, else its name, and its `RecurringTransaction::Identifier#identify_recurring_patterns` only claims a series of the pattern's identity or creates a `suggested` one: nothing moves a series to a new key. Archant's `detectWithin` first runs `rekey` (Spec 11.8), which moves a series onto the key its latest rows now carry, so renaming « NETFLIX » rows to the merchant « Netflix » carries the old series, its label and its history onto the new key, and no suggestion appears.

**Approach:** `rekey` and `RekeyStep` leave `packages/api/src/domain/recurring/series.ts`, and `detectWithin` in `packages/api/src/services/recurring/series.ts` stops calling it. The old series keeps its key, label and payments; the renamed rows form a pattern that claims a series of their key or lands as `suggested`; « Nettoyer les obsolètes » retires the old one past Sure's threshold, as `cleaner.rb`.

## Boundaries & Constraints

**Always:** claiming, `suggested` creation with `dedupScope`, the refresh pass, `cleanerSteps` and the ended tombstone work as today; a recurring transfer is untouched; AD-24 in `docs/architecture.md` loses its mention of `rekey`; `docs/sure-parity.md` « Renamed series » reads Parity.

**Never:** no migration and no rewrite of series a past `rekey` already moved; no change to `refreshSeries`, `claimOf`, `cleanerSteps` or the threshold; no interface change; no Playwright change.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Rows take a merchant | active series « PRLV NETFLIX », its three rows set to merchant `netflix` | series keeps label key and label; a new `suggested` series keyed on `netflix` | none |
| Rule renames the rows | active series « PRLV EDF », rule sets « EDF ENERGIE » | old stays `active` on « prlv edf »; `suggested` « EDF ENERGIE » beside it | none |
| Ended series renamed | ended « PRLV EDF », rows renamed | stays `ended` on its key; the new key's pattern lands `suggested`, as Sure's tombstone is per identity | none |
| Declared bill renamed | manual bill with payments and a price change | keeps its key, occurrences, payments and price change; cleanup retires it past six months | none |
| Old series, cleanup | renamed series with no row past `staleBefore` | « Nettoyer les obsolètes » makes it `inactive` | none |

</frozen-after-approval>

## Code Map

- Sure `00dd977fb`: `app/models/recurring_transaction/identifier.rb` `identify_recurring_patterns` (claim by identity, else `create_suggested_series`; no re-key), `app/models/recurring_transaction/cleaner.rb`.
- `packages/api/src/domain/recurring/series.ts:169-251` -- `RekeyStep`, `rekey`: delete. `withinBand`, `sameKey`, `seriesKeyOf`, `direction`, `occurrencesOf` stay used by `matches` and `refreshSeries`; drop only imports left unused.
- `packages/api/src/services/recurring/series.ts` -- `detectWithin`: drop the `rekey` call and its `oneByOne` of moves; `current` starts from `loadSeries(tx)`; doc comment loses its first-pass sentence. Check `oneByOne` and other imports stay used.
- `packages/api/src/domain/recurring/series.spec.ts:68-240` -- `describe("rekey")`: delete.
- `packages/api/src/services/recurring/series.spec.ts:1337` -- « detection follows a renamed series and never deletes one »: rename the block, rewrite the merchant, rule and ended cases to the old series kept plus a new suggestion; keep the twin, declared-bill, latest-row and two-keys cases.
- `docs/architecture.md:234` -- AD-24: « detection's refresh and `rekey` leave it alone » becomes « detection's refresh leaves it alone ».
- `docs/sure-parity.md:217` -- « Renamed series » row: Archant now leaves the twin; status Parity.

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/services/recurring/series.spec.ts` -- rewrite the rename cases first (failing): series kept with key, label and payments, suggestion beside it, cleanup retiring the old one.
- [x] `packages/api/src/domain/recurring/series.ts`, `series.spec.ts` -- delete `rekey`, `RekeyStep` and their tests.
- [x] `packages/api/src/services/recurring/series.ts` -- `detectWithin` without `rekey`.
- [x] `docs/architecture.md`, `docs/sure-parity.md` -- as the Code Map says.
- [x] Story and `sprint-status.yaml` to `done`; Epic 33 stays `in-progress`.

**Acceptance Criteria:**
- Given the finished story, when `pnpm lint:code` runs, then no `rekey` or `RekeyStep` symbol remains in `packages/`.
- Given the finished story, when `pnpm test` and `pnpm test:e2e` run, then both pass with Playwright unchanged.

## Implementation Notes

## Spec Change Log

## Review Triage Log

Review by `bmad-build` step 4 (Blind Hunter, Edge Case Hunter, Verification Gap) on the diff since `13234e43`; no second `bmad-code-review` pass over the same diff, to keep usage low. Implemented in the main session rather than a sub-agent. The Verification Gap layer found no gap.

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | Last task ticked while the spec reads `in-review` and the sprint status `in-progress` | low | patch | Step 5 sets both to `done` in the same commit. |
| 2 | `deferred-work.md` and Spec 23.3's triage row still describe `rekey`'s delete | false | reject | Both are dated records; the deferred entry already names Story 27.4, which removed the delete. |
| 3 | `detectWithin`'s rewritten comment overflows its width and grounds the rule on no Sure revision | low | patch | Comment reflowed; it says Sure's identifier still has no re-key at `00dd977fb`. |
| 4 | Merchant case no longer asserts the detection count nor the old series' count and date | low | patch | It asserts `{ detected: 1 }`, `occurrenceCount: 0` and `lastOccurrenceDate`. |
| 5 | Renamed rows could pay the new series' occurrences too once it is accepted | false | reject | `domain/recurring/matcher.ts` skips transactions already in a confirmed payment and takes each entry once. |
| 6 | The old active series keeps due occurrences and reads overdue until « Nettoyer les obsolètes » | low | patch | Sure does the same; recorded in Design Notes and the PR's upgrade note. |
| 7 | The latest-row, two-keys and suggested-twin cases were written for `rekey` | low | reject | They still pin that no series moves and no twin is lost; the block's title now says what they protect. |
| 8 | The matrix's merchant row starts from « PRLV NETFLIX », the test from « NETFLIX » | low | reject | The story's own criterion names « NETFLIX »; the key logic is identical. |
| 9 | « No `rekey` symbol » is not something knip checks | low | reject | `git grep rekey -- packages` returns nothing; checked by hand. |
| 10 | Nothing carries the upgrade effect into the release notes | low | reject | The PR's What ends with the upgrade note, which the release notes link. |
| 11 | A renamed suggestion stays beside its twin, since the cleaner retires only active series | low | reject | Sure's cleaner retires only active series too; the owner ends it, as Story 33.1 recorded. |
| 12 | The suggested-old-series path lost coverage | false | reject | « keeps a suggested series left with no row, suggested » renames a suggestion's rows and asserts it stays. |

## Design Notes

Assumptions taken alone, each settled by Sure:

- An ended series whose rows are renamed no longer follows them: the new key's pattern lands `suggested`, because Sure's identifier claims an ended tombstone only of the pattern's own identity.
- The old non-manual series keeps the count and dates `refreshSeries` already gives a series whose rows left its window (its last date, count 0); changing that pass is out of this story.
- The old active series keeps its open and future occurrences, so it reads overdue on « Factures » until « Nettoyer les obsolètes » retires it, as Sure's pipeline generates every active series' occurrences.
- Upgrade: nothing stored changes. A series a past `rekey` moved stays on its new key. From the upgrade on, renamed rows leave their series where it is and come back as a new suggestion after the next detection.

## Verification

**Commands:**
- `pnpm --filter @archant/api exec vitest run --project unit src/services/recurring/series.spec.ts src/domain/recurring/series.spec.ts` -- expected: pass.
- The repository's verification gate in `AGENTS.md` -- expected: pass, no tracked file changed after it.

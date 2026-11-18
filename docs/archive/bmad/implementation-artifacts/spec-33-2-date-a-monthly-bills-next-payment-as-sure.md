---
title: "Story 33.2: Date a monthly bill's next payment as Sure"
type: 'feature'
created: '2026-10-28'
status: 'done'
baseline_commit: '145b9baf97106ced2d7b9c16716ed743278ab07d'
route: 'dispatch'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Sure (`00dd977fb`) dates every series' next payment after its latest row with one shim, `Schedule#next_occurrence_after` (`app/models/recurring_transaction/schedule.rb:172-176`): a plain monthly series, `legacy_monthly?`, takes `occurrence_in_month(date.next_month)`, its expected day in the month after the row's, clamped to that month's end (`schedule.rb:409-413`); any other its `first_occurrence_after`. The identifier (`identifier.rb:189`, `:350`, `:393` through `:531`) and the model (`recurring_transaction.rb:585`, `:711`) all call it. Archant's `nextExpectedAfter` in `packages/api/src/domain/recurring/schedule.ts` keeps Spec 9.2's rule for a plain monthly series instead, the expected day nearest to one month after the row, so a bill due on the 28th paid late on 2 March reads 28 March where Sure reads 28 April, and a bill due on the 1st paid on 31 August reads 1 October where Sure reads 1 September.

**Approach:** `nextExpectedDate` in `packages/api/src/domain/recurring/series.ts` calls `nextOccurrenceAfter`, which already is Sure's shim, and `nextExpectedAfter` goes, since Sure has one function where Archant had two. `dueFrom` and `nextOccurrenceFromToday` stay.

## Boundaries & Constraints

**Always:** every schedule other than a plain monthly one keeps its `firstOccurrenceAfter` date; an installment past its last payment keeps `last`, as `nextExpectedDate` does today; a date from today on (`dueFrom`, `currentNextDate`) is unchanged.

**Ask First:** none; the owner is unavailable and Sure settles every decision below.

**Never:** no migration; no change to `dueFrom`, `nextOccurrenceFromToday` or the matcher; no interface change.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Late payment | monthly on the 28th, latest row 2 March | 28 April | none |
| On time | monthly on the 5th, latest row 5 September | 5 October | none |
| Early across the month end | monthly on the 1st, latest row 31 August | 1 September | none |
| Clamped month | monthly on the 31st, latest row 15 January | 28 February, 29 in a leap year | none |
| Non-monthly | quarterly on the 10th anchored 10 February, latest row 12 May | 10 August | none |
| Ended installment | three payments from 5 January, latest row 5 March | `null`, so `nextExpectedDate` keeps 5 March | none |

</frozen-after-approval>

## Code Map

- Sure `00dd977fb`: `app/models/recurring_transaction/schedule.rb` (`next_occurrence_after`, `occurrence_in_month`, `legacy_monthly?`), `app/models/recurring_transaction/identifier.rb` (`next_expected_date` on create and update), `app/models/recurring_transaction.rb` (`calculate_next_expected_date`).
- API: `domain/recurring/schedule.ts` (`nextOccurrenceAfter`, `nextExpectedAfter` removed), `domain/recurring/series.ts` (`nextExpectedDate`).
- Tests: `domain/recurring/schedule.spec.ts` (`nextOccurrenceAfter`), `domain/recurring/series.spec.ts` (`nextExpectedDate`).
- Docs: `docs/sure-parity.md` « Next date » row becomes Parity.

## Tasks & Acceptance

**Execution:**
- [x] Specs first: `nextExpectedDate` for the late payment, the early payment across the month end, the clamped month in a common and a leap year, a quarterly schedule and an ended installment; `nextOccurrenceAfter` gains the late payment and the leap year.
- [x] `nextExpectedDate` calls `nextOccurrenceAfter`; `nextExpectedAfter` and its specs go.
- [x] Docs, story and sprint status, Epic 33 in progress.

**Acceptance Criteria:**
- Given a series with one monthly rule on the 28th, every month, no end, and its latest row on 2 March, when detection or the manual pass computes its next date, then it is 28 April.
- Given a series due on the 31st whose latest row is on 15 January, when its next date is computed, then it is 28 February, or 29 in a leap year.
- Given any other schedule, or a date from today on, when its next date is computed, then nothing changes.

## Design Notes

Assumptions taken alone, each settled by Sure or by an Archant convention:

- `nextExpectedAfter` is removed rather than rewritten: once it follows Sure it is `nextOccurrenceAfter` line for line, and Sure has the one shim. The story names `nextExpectedAfter`; the behaviour it asks for now lives in `nextOccurrenceAfter`, which `nextExpectedDate` calls.
- Upgrade: nothing stored changes at once. The next detection, after a sync, an import, a revert or « Identifier les modèles », rewrites a plain monthly series' next date from its latest row with Sure's rule. A bill paid a few days late then reads the following month's day, as in Sure, and one paid early across a month end reads the coming month's; `currentNextDate` still moves any date already past to the first one from today.

## Review Triage Log

Review by `bmad-build` step 4 (Blind Hunter, Edge Case Hunter, Verification Gap) on the diff since `145b9baf`; no second `bmad-code-review` pass over the same diff, to keep usage low. Implemented in the main session rather than a sub-agent. The Verification Gap layer found no gap: every caller of `nextExpectedDate`, `refreshSeries`, detection and a bill's schedule edit, passes its result through unchanged or through `currentNextDate`.

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | Epic 9's notes still say Spec 9.2's next date for a plain monthly series stays | low | patch | `epics.md` now carries « Revised by Story 33.2 », as its other revised notes. |
| 2 | The story's criterion names `nextExpectedAfter`, which goes | false | reject | Design Notes record why: once it follows Sure it is `nextOccurrenceAfter`, Sure's one shim; the criterion's dates hold through `nextExpectedDate`. |
| 3 | No service test asserts detection writes 28 April | low | reject | Detection reads `nextExpectedDate` only, whose spec asserts 28 April; the service specs pass unchanged. |
| 4 | A bill's schedule edit (`services/recurring/bills.ts`) also takes the new rule | low | reject | It calls `nextExpectedDate` for a suggested or ended series, as Sure's edit calls `next_occurrence_after`; the PR's upgrade note names it. |
| 5 | The 30-day window of `listRecurring` and the sort move with the date | low | reject | Same consequence in Sure, whose `upcoming_within_days` reads the same `next_expected_date`. |
| 6 | A late row across the month end now skips a month | false | reject | It is Sure's behaviour, the story's first criterion; the late-payment row covers it. |
| 7 | The on-time matrix row has no exact test | low | patch | `nextOccurrenceAfter` asserts 5 September → 5 October. |
| 8 | A test name describes the removed rule | low | patch | Renamed to « takes the month after a late row's ». |
| 9 | The parity row's plain monthly definition omits every month and never ending | low | patch | Row now says « one monthly rule every month on a day other than the last, never ending ». |
| 10 | Spec status, sprint status and the empty triage log disagree mid-review | false | reject | Step 5 sets both to `done` and this log is written at triage. |
| 11 | `nextExpectedDate` lacks the common-year February clamp | low | patch | `series.spec.ts` asserts 15 January 2026 → 28 February beside 2028's 29th. |

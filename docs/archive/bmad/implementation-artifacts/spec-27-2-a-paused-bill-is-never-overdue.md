---
title: 'Story 27.2: A paused bill is never overdue'
type: 'bugfix'
created: '2026-10-09'
status: 'done'
baseline_commit: '212adff594327eb0bdcf4aaa9684804672d2b6f6'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-27-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A paused bill's leftover open occurrence still reads `overdue` or `due` everywhere but the overview's sections: its row in « Inactives » and its current occurrence in « Toutes les factures » and the bill drawer turn red with « N jours de retard », the « En retard » and « Bientôt due » filters list it, and `get_bills` matches, counts and reports it as overdue. Sure stopped this in `809c7f82e` (#3971).

**Approach:** Sure's #3971: one domain helper gives an occurrence the state every read shows, `derivedState` for an active series, the series' `display_status` for an open occurrence of any other; every read that feeds the interface or a tool takes its `state` from it, so `state === "overdue"` and `state === "due"` mean Sure's `overdue?` and `due?`. `derivedState` stays the raw schedule state for the matcher and `record_bill_payment`'s `not_due` check.

## Boundaries & Constraints

**Always:**
- Helper in `domain/recurring/occurrences.ts`, `occurrenceState(occurrence, seriesStatus, today)`, returning `OccurrenceState = DerivedState | "paused" | "ended" | "suggested"`: a closed occurrence reads its status; an open one of an `active` series reads `derivedState`; an open one of an `inactive` series reads `"paused"`, of an `ended` one `"ended"`, of a `suggested` one `"suggested"`, as Sure's `display_status`.
- Every producer of a read's `state` calls it: `loadBills` (overview rows, occurrence sheet, `get_bill_details`), `currentOccurrences` (« Toutes les factures », the bill drawer, `get_bills`), and the result of `recordBillPayment` (`record_bill_payment`, which Sure serialises with the same `serialize_occurrence`). `daysLate` is set only when that state is `overdue`.
- Filters follow from it unchanged: `inStatus` « overdue » and « due », `inPaymentState` `overdue`, `due` and `upcoming`, `overdueCount`, the overview's `attention`. The interface keeps comparing `state`: `dueLabel`, `CurrentOccurrence`, `BillRow`'s colour and « Bientôt due » badge, `OccurrenceSheet`'s title colour.
- Tools: the `state` enum of `occurrenceFields` gains `paused`, `ended`, `suggested`; its description and `payment_state`'s say, as Sure's `get_bills`, that nobody pays a paused or ended bill, so its unpaid occurrence is never `overdue` or `due` and its state reads the bill's status instead.
- `docs/sure-parity.md` « Status » (bills) reads Parity, Story 27.2; « Assistant tools for bills » stays Later for 27.13, its note saying `"paused"` shipped with 27.2.

**Never:** no change to `derivedState`, `matcher.ts` or `payments.ts`'s `not_due` test; no status prefix on the due label (« Inactif · … », Sure's #3955 row rework); no change to `audit.ts`, which already reads active series only; no new payload field; no other tool field (Story 27.13).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected |
|---|---|---|
| Paused, late | `inactive`, open occurrence 10 days past | `state: "paused"`; « Inactives » row grey, no « jours de retard »; not in « En retard »; `overdue_count` 0 |
| Paused, near | `inactive`, open occurrence in 2 days | `"paused"`; no « Bientôt due »; not in « Bientôt due » nor `payment_state: "upcoming"` |
| Ended, open | `ended`, open occurrence past | `"ended"` |
| Paused, paid | `inactive`, last occurrence `paid` | `"paid"`, matches `payment_state: "paid"` |
| Active, late | `active`, 10 days past | `"overdue"` as today, in « Requiert votre attention » |
| Resumed | paused bill set `active` again | its open occurrence reads `overdue` again |
| Matcher | paused series, late payment | matching unchanged, window still open to today |

</frozen-after-approval>

## Code Map

- `packages/api/src/domain/recurring/occurrences.ts:33,72` -- `DerivedState`, `derivedState`; add `OccurrenceState` and `occurrenceState` beside them, importing `RecurringStatus` from `@archant/data/schema/recurring-transactions`.
- `packages/api/src/services/recurring/bills.ts:614,776` -- `BillRow.state` and `loadBills`, which already selects `seriesStatus`; `:858` `attention` reads active rows only, unchanged; `:1128` `inStatus`.
- `packages/api/src/services/recurring/occurrences.ts:263-325` -- `CurrentOccurrence.state`, `currentOccurrences(db, ids, day)`: take the series' statuses, e.g. `series: { id; status }[]`; caller `services/recurring/series.ts:546` `toRecords`, whose rows carry `status`.
- `packages/api/src/services/recurring/bill-reads.ts:92,174,193` -- `inPaymentState`, `overdueCount`, `OccurrenceView.state`: types only, behaviour follows.
- `packages/api/src/services/recurring/payments.ts:610,712` -- the recorded occurrence's `state`; keep `:689` on `derivedState`.
- `packages/api/src/mcp/bills.ts:64-70,104-108,183` -- `DERIVED_STATES`, the `state` description, `occurrenceOf`.
- `packages/api/src/schemas/assistants.ts:1011-1016` -- `payment_state` description.
- `packages/app/src/components/BillLabels.tsx:16,44,162`, `routes/_authed.bills.tsx:109,122`, `components/OccurrenceSheet.tsx:400` -- read `state` as today; types follow from the RPC.
- `docs/sure-parity.md:204,226`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/domain/recurring/occurrences.spec.ts` -- first, failing: `occurrenceState` for every row of the matrix's statuses, closed occurrences of a paused series, and `derivedState` unchanged.
- [x] `packages/api/src/domain/recurring/occurrences.ts` -- the helper and type.
- [x] `packages/api/src/services/recurring/bills.spec.ts` -- failing first: a paused bill 10 days late reads `paused` in `billsOverview`'s `inactive` and `occurrenceDetail`, and is left out of `allBills` filters « overdue » and « due ».
- [x] `packages/api/src/services/recurring/bill-reads.spec.ts` -- failing first: `findBills` leaves it out of `overdue`, `due`, `upcoming` and `overdueCount`; `billHistory`'s open occurrence reads `paused`.
- [x] `services/recurring/bills.ts`, `occurrences.ts`, `series.ts`, `bill-reads.ts`, `payments.ts` -- call the helper; `currentOccurrences` takes statuses.
- [x] `packages/api/src/mcp/bills.ts`, `schemas/assistants.ts`, `mcp/bills.spec.ts` -- enum and descriptions; `get_bills` with `payment_state: "overdue"` omits the paused bill and reports `state: "paused"` under `status: "paused"`.
- [x] `packages/app/e2e/bills.spec.ts` -- in « each occurrence sits in its section… », the paused « Gaz » row 5 days late shows « Échéance le … », no « jours de retard » and no `text-destructive`, as the story asks of Playwright; the filters stay with Vitest.
- [x] `docs/sure-parity.md` -- the two rows.

**Acceptance Criteria:**
- Given a paused bill whose occurrence is past its date, when the owner opens « Factures », « Toutes les factures » or its drawer, then nothing shows it late or due, and screenshots of « Inactives » and of its line in « Toutes les factures » are checked in self-review.
- Given the finished story, when `pnpm test` and `pnpm test:e2e` run, then both pass.

## Design Notes

Sure's views ask `overdue?`; Archant's interface reads `state` from the API. Giving `state` Sure's tool vocabulary in every read keeps one value per occurrence across the page and the tools, adds no field, and leaves every existing `state === "overdue"` check correct. Raw schedule state is needed only where Sure reads `derived_state` directly: the matcher's window and `record_bill_payment`'s not-yet-due refusal, both already calling `derivedState`.

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck` -- expected: clean.
- `pnpm test` -- expected: both Vitest projects pass.
- `pnpm test:e2e` -- expected: all five Playwright projects pass.

## Implementation Notes

- Pausing drops a series' future occurrences, so a paused bill only ever holds past ones: the « due » cases use an occurrence inside its grace days, and `upcoming` is asserted empty.
- `currentOccurrences` takes `{ id, status }[]`; its only caller, `toRecords`, passes its rows.
- `recordBillPayment` reads the series' status in the select that already checked it exists.
- `pipeline.spec.ts` covers the matrix's « Matcher » row: a paused series' late occurrence is still paid by a late payment.
- QA: before and after captures of « Inactives » and « Toutes les factures » at 1280 px; the paused row is no longer red, the active late bill still is.

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Evidence | Route |
|---|---|---|---|
| Tool `state` description names paused and ended, not suggested | low | Real: `get_bills` with `status: "suggested"` can return one. | patch |
| « Matcher » matrix row untested | low | Real: no test pinned it, though `matcher.ts` is untouched. | patch (`pipeline.spec.ts`) |
| Test name hides that it also resumes | low | Real. | patch |
| e2e reads `.text-destructive` rather than a role | low | The colour is the claim; `splits.spec.ts` reads classes the same way. | rejected |
| `"inactive"` → `"paused"` repeats `STORED_STATUS` | low | The domain cannot import a service; one line. | rejected |
| `OccurrenceState` and `OCCURRENCE_STATES` list the same three words | low | The tool enum spreads `OCCURRENCE_STATUSES` likewise; a shared array adds an export for one reader. | rejected |
| `dueLabel` shows « À payer … » for a paused bill due today or later | false | Pausing drops future occurrences; the status prefix is #3955, out of scope by the spec. | rejected |

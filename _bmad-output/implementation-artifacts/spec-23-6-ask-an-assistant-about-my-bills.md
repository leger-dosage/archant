---
title: 'Story 23.6: Ask an assistant about my bills'
type: 'feature'
created: '2026-10-07'
status: 'done'
route: 'dispatch'
baseline_commit: 'e9924f4ba3279a4e312a64278d38561718c36ae3'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-23-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** An assistant connected through `/api/mcp` sees only `get_recurring_transactions`: it cannot read a bill's occurrences and payments, review the bills, declare one, edit one or record a payment, so the owner cannot go through their bills in conversation.

**Approach:** Add Sure's six bill tools from #3203 (read at `14638a701`), `get_paycheck_plan` left out: three reads (`archant:read`) and three writes (`archant:write`) in a new `mcp/bills.ts`, each calling one service function that runs the interface's own rules (AD-19, NFR19). Story 23.6 of `epics.md` is the acceptance contract; this spec adds what reading the code settled.

## Boundaries & Constraints

**Always:**
- References are ids, as AD-19 says and Story 17.5 did: `billId`, `accountId`, `categoryId`, never a name. This replaces the story's « account and category by exact name ».
- Output amounts are positive decimal strings beside their `currency`; `billType` carries the direction (`income`), as Sure's. Input amounts are decimal strings parsed in the account's currency, never negative.
- A bill's shape, shared by the three reads: `id`, `name` (typed name, else merchant, else label), `billType`, `status` (`paused` for stored `inactive`), `amount`, `amountMin`/`amountMax` when the band spreads, `currency`, `frequency` (a preset of `FREQUENCY_PRESETS` or `custom`), `nextDueDate`, `autopay`, `detectedAutomatically` (`!manual`), `accountId`, `accountName`, `categoryId`, `monthlyEquivalent`, `paymentUrl`. An occurrence: `dueOn`, `effectiveDueOn`, `state` (`derivedState`), `expected`, `paid`, `remaining`, `partiallyPaid`.
- `get_bills`: `status` (`active` default, `suggested`, `paused`, `ended`, `all`), `paymentState` (`overdue`, `due`, `upcoming`, `partial`, `paid`, on the current occurrence), `billType`, `search` (name, merchant, label, case-insensitive), `dueWithinDays` (1–365); ordered by next due date; at most 100 with `total` and `truncated`; `totals` over every match: `activeCount`, `overdueCount`, and the monthly equivalent of active non-income bills in the reporting currency, with `leftOutFields` for bills in another currency (NFR2), where Sure groups by currency.
- `get_bill_details`: the bill plus `anchorDate`, `endAfterCount`, `notes`, `schedulePinned`; its open occurrences; the last twelve closed occurrences with their payments (`amount`, `paidOn`, `source`, `state`, `transactionId`, `transactionLabel`); the next three due dates; price changes of the last 24 months with Sure's percent (`changePercent`).
- `get_bill_audit`: `lookbackMonths` 1–24, default 12. Sections, each `{ items (first 20), count, truncated }`: `possibleDuplicates` (active bills sharing normalised display name, signed amount and expected day), `priceChanges` (any status, since the lookback), `longOverdue` (active non-income bills whose next due date is a whole cycle or more past, most cycles first, as Sure's `cycles_overdue`), `dormant` (paused bills with an open occurrence), `awaitingConfirmation` (suggestions), `undeclaredCandidates` (the declare dialog's bill candidates without its cap of eight).
- `create_bill`: `name`, `amount`, `firstDueOn`, `accountId` required; `frequency` (preset, default `monthly`), `isIncome`, `billType` (`bill`, `subscription`, `installment`, `other`, ignored for income), `categoryId`, `autopay`, `paymentUrl`, `notes`. Through `declareBill`, which gains `billType` and `categoryId`; returns the bill and its next three due dates. Annotations `CREATES`.
- `update_bill`: `billId` and any of `name`, `amount` (from now on: due occurrences keep the old one), `accountId`, `categoryId` (`null` clears), `billType` (never to or from `income`), `status` (`active` or `paused`), `frequency` with `dueDayOfMonth`, `weekday` or `monthOfYear`, `autopay`, `paymentUrl`, `notes`. A day without `frequency` answers `VALIDATION_ERROR` `requires_frequency`; nothing given answers `empty_patch`. Edit and status in one transaction through a new `updateBill`, a refusal writing nothing. Returns `changedFields` and the bill. Annotations `SETS`.
- `record_bill_payment`: `billId`, optional `occurrenceDueOn`, `amount`, `paidOn` (today by default). No amount settles what remains through `markPaid`'s write; an amount adds a partial payment through `addPayment`'s, refused above what remains (`exceeds_remaining`). Without `occurrenceDueOn` it pays the current occurrence; settling one still `upcoming` answers `not_due`, as Sure's guard against a retry paying next month. A date with no open occurrence answers `NOT_FOUND`. It never links a transaction. Annotations `CREATES`.
- Each call is recorded in `assistant_calls`; `changedRows` is 1 per series or payment written.
- `INSTRUCTIONS` gains: a suggestion is not a bill yet; before `create_bill`, `update_bill` or `record_bill_payment`, tell the owner what will change and wait for their agreement.

**Never:** no `get_paycheck_plan`; no trial or renewal section (deferred with subscription dates); no account-less bill (AD-6); no new route or screen; no write from a read tool; no lookup by name.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected |
|---|---|---|
| Default list | active, paused, suggested and ended bills | active only, by next due date |
| Paused | `status: "paused"` | stored `inactive`, shown `paused` |
| Due soon | `dueWithinDays: 10` | next due within ten days |
| Totals | an income, a bill in USD | income out of the sum; USD bill counted in `leftOutCount` |
| Too many | 101 active bills | 100 items, `truncated: true`, totals over 101 |
| Bad range | `dueWithinDays: 0` | `VALIDATION_ERROR` on `dueWithinDays` |
| Details | the declared mortgage, four paid months | four closed occurrences with their payments, next three dates |
| Duplicates | two active « Netflix » 13,49 € on the 5th, a third at 17,99 € | one group of two |
| Long overdue | a monthly bill 40 days past due | `cyclesOverdue: 1`; 20 days past due is absent |
| Create | income, `categoryId` of an expense category | positive series, type `income`, no category |
| Duplicate create | same account, key and amount | `RECURRING_ALREADY_EXISTS` |
| Raise | `amount: "15.99"` on a bill with an overdue occurrence | overdue keeps 13,49 €, future reads 15,99 € |
| Pause and rename | `status: "paused"`, `name` | both written, one call |
| Settle | no amount, current occurrence overdue | remaining paid, occurrence `paid` |
| Too early | no amount, current occurrence `upcoming` | `VALIDATION_ERROR` `not_due`, nothing written |
| Partial | `amount: "100.00"` of 571,29 € | occurrence open, `remaining` 471,29 € |
| Overpay | amount above what remains | `VALIDATION_ERROR` `exceeds_remaining` |
| Read token | any write tool | `403 insufficient_scope`, recorded, nothing written |

</frozen-after-approval>

## Code Map

- `packages/api/src/mcp/tool.ts` -- `defineTool`, `READ_ONLY`, `CREATES`, `SETS`, `BANK_TEXT`, `decimal`, `leftOutFields`, `leftOutOf`.
- `packages/api/src/mcp/recurring.ts` -- `get_recurring_transactions`, the closest tool; stays unchanged.
- `packages/api/src/mcp/server.ts:71` `TOOLS` (reads before writes), `:111` `INSTRUCTIONS`.
- `packages/api/src/schemas/assistants.ts` -- `z.strictObject` inputs with `.describe()`; `updateBudgetInput`'s `empty_patch`.
- `packages/api/src/services/recurring/bills.ts` (1360 lines) -- `declareBill` :180 (add `billType`, `categoryId`), `editBill` :278, `billCandidates` :428 (cap of 8 to move into the dialog's caller of a new uncapped `candidatePatterns`), private `loadBills` :633, `withAmounts` :988, `priceChangesWhere` :1110 to export; `billDetail` :1244 stays the drawer's.
- `packages/api/src/services/recurring/series.ts` -- `RecurringRecord`, `listRecurring` :594 (holds suggestions, which `allBills` leaves out), `getRecord`, `setRecurringStatus` :629 (`ALLOWED_FROM`), `notFound`, `invalid`.
- `packages/api/src/services/recurring/payments.ts` -- `markPaid` :610, `addPayment` :510 (requires `paidOn` without an entry), `confirmedOf`, `freezeExpected`, `refreshCloseState`, `mustBeOpen`: extract the write bodies into `tx` helpers that `recordBillPayment` reuses.
- `packages/api/src/services/recurring/occurrences.ts` -- `currentOccurrences` :278.
- `packages/api/src/domain/recurring/` -- `schedule.ts` (`monthlyEquivalent` :258, `occurrencesPerYear` :239, `cycleFor`), `occurrences.ts` (`derivedState`, `remainingOf`, `changePercent`, `effectiveDueOn`), `frequency.ts` (`FREQUENCY_PRESETS`, `detectFrequency`, `applyFrequency`).
- `packages/api/src/schemas/bills.ts` -- `declareBodySchema`, `editBodySchema`, `EDITABLE_BILL_TYPES`, `frequencyBody`.
- `packages/api/src/testing/assistant.ts` (`callTool`, `connect`, `registerClient`, `READ_WRITE`), `testing/recurring.ts` (`declareMortgage`, `addRows`, `setToday`, `occurrencesOf`, `payments`).
- `packages/api/src/mcp/server.spec.ts` -- `READ_TOOLS`, `WRITE_TOOLS` :56-92, annotations map ~:402, `callsRecorded`.
- `packages/app/src/locales/fr.json:2000-2001`, `packages/app/e2e/assistants.spec.ts:234-237` -- consent labels.
- Docs: `docs/deployment.md:314-325`, `docs/security-model.md:75`, `docs/sure-parity.md:220` and `:246`.
- Sure, `git -C ~/github/sure show 14638a701:app/models/assistant/function/<tool>.rb` and `bills_support.rb`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/mcp/bills.spec.ts` -- first: every matrix row through the MCP handler, each call recorded with its count, amounts matching the bills routes'.
- [x] `packages/api/src/services/recurring/bill-reads.ts` -- `findBills(deps, query)` and `billHistory(deps, id)`, built on the helpers exported from `bills.ts`, with their specs.
- [x] `packages/api/src/services/recurring/audit.ts` -- `billAudit(deps, lookbackMonths)`, the six sections, with its spec.
- [x] `packages/api/src/services/recurring/bills.ts`, `schemas/bills.ts` -- `declareBill` takes `billType` and `categoryId`; `updateBill` runs edit and status in one transaction; `candidatePatterns` uncapped. `routes/recurring.spec.ts` stays green unchanged.
- [x] `packages/api/src/services/recurring/payments.ts` -- `recordBillPayment`, sharing `markPaid`'s and `addPayment`'s writes.
- [x] `packages/api/src/schemas/assistants.ts`, `mcp/bills.ts`, `mcp/server.ts`, `mcp/server.spec.ts` -- inputs, six tools, `TOOLS`, `INSTRUCTIONS`, tool lists and annotations.
- [x] `fr.json`, `e2e/assistants.spec.ts` -- the scope labels name bills.
- [x] Docs in the Code Map; `epics.md` needs no edit, since Epic 26 already dropped bills from Epic 16's left-out list.

**Acceptance Criteria:**
- Given Story 23.6 of `epics.md`, when the story ships, then each criterion holds with the decisions this spec records.
- Given a read token, when `tools/list` runs, then the three reads are listed read-only and no write is.

## Design Notes

Ids instead of names: AD-19 says « references as ids », and Story 17.5 refused a lookup by name for the same reason. An id also removes Sure's namesake error, since Archant's account names are not unique. The assistant gets ids from `get_accounts` and `get_categories`.

`get_bills` and `get_bill_details` get their own service functions instead of extending `allBills` and `billDetail`: those serve the table and the drawer, which want neither suggestions, a 100-row cap, closed occurrences with their payments nor 24 months of price changes. They share `loadBills` and `withAmounts`, so a bill reads the same on the page and in the tool.

Totals use the reporting currency with the left-out fields, as every other Archant tool, instead of Sure's map per currency.

`bills.ts` already holds 1360 lines, so the reads and the audit go in new files of `services/recurring/`.

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck` -- expected: clean
- `pnpm test` -- expected: green
- `pnpm test:e2e` -- expected: green, consent labels updated

## Implementation Notes

- An income is always uncategorised, whatever `categoryId` says, as detection writes one; a category id is checked only for a bill.
- `update_bill` with the status a bill already has changes nothing and succeeds, since its annotations are `SETS`, idempotent.
- `nextDueDate` is the open occurrence's effective date, else `nextExpectedDate`; Sure's fallback for a series with no occurrence generated yet is not ported.
- `dueWithinDays` keeps overdue bills, as Sure's `next_due_date <= today + days`.
- An interval cadence no preset names reads `custom`.
- `changedFields` lists the fields the call gave, not a before-and-after comparison; `changedRows` is 1 for any successful write.
- `editBill`, `setRecurringStatus`, `markPaid` and `addPayment` now call `editWithin`, `setStatusWithin`, `settle` and `addManualPayment`, which `updateBill` and `recordBillPayment` share; `billCandidates` slices the uncapped `candidatePatterns` to eight. `routes/recurring.spec.ts` passes unchanged.
- `declareBodySchema` accepts optional `billType` and `categoryId`; the declare dialog sends neither.

## Spec Change Log
- Owner rule of 2026-10-07, settled for the field names: every assistant tool names its input and output fields in snake case, Sure's names where Sure's function has the field, the snake case of Archant's own otherwise, so the server uses one style throughout; a refusal names the tool's field. The HTTP API keeps camel case. KEEP: amounts as decimal strings (money). Here: the bill tools take and answer Sure's snake case names, `bill_id`, `bill_type`, `payment_state`, `due_within_days`, `first_due_on`, `is_income`, `occurrence_due_on`, `paid_on`, `lookback_months`, `current_occurrence`, `next_due_date`, Sure's `percent_change` and `upcoming_due_dates`, and `get_bills` answers `total_results`.

## Review Triage Log

| Layer | Finding | Verdict | Evidence | Route |
|---|---|---|---|---|
| blind | `create_bill` cannot declare from an audit candidate's transaction, so the bill keys on its name and never matches the candidate's lines | medium | `knownNames` in `domain/recurring/matcher.ts` matches a label-only series on its key, name and aliases only; the dialog passes `entryId`, the tool could not | patch: optional `entryId`, returned by `undeclaredCandidates` |
| blind, edge | Duplicate key has no currency nor frequency | low | Same name, minor amount and day in two currencies is rare; Sure's `duplicate_key` has neither | rejected: parity |
| blind, verification-gap | `longOverdue` described as « the latest first » | low | Code and spec sort by most cycles | patch |
| blind | `dormant` gives no amount, candidates no account name | low | Sure's `dormant` items are `{bill_id, name, status}` | rejected: parity |
| blind, edge | `update_bill` cannot set `endAfterCount` | low | Sure's `update_bill` has no `end_after_count` either | rejected: parity |
| blind, edge | `changedFields` lists fields given, `changedRows` always 1 | low | A status already held is listed; the spec records the rule in Implementation Notes | patch: description says « given » |
| blind | A day that does not fit the cadence passes | low | `applyFrequency` reads only the fields of its preset, as Sure's `FrequencyPreset.apply` | rejected: parity |
| blind, edge | `nextDueDates` given for a paused or ended bill; from today in `create_bill`, after today in `get_bill_details` | low | Sure's `upcoming_due_dates` reads the schedule alone, with the same two starts | rejected: parity |
| blind, edge | `recordBillPayment` accepts a paused bill and any `paidOn` | low | The occurrence sheet pays a paused bill's open occurrence at any date too; a suggestion has no occurrence | rejected |
| blind, edge | `not_due` guards only a settle | low | As Sure's `RecordBillPayment`; a partial is capped at what remains | rejected: parity |
| blind | The declare route accepts `billType` and `categoryId` untested | low | Same schema and service checks as the tool's, which tests cover; no new route | rejected |
| blind | An expense bill accepts an income category | low | `editBill` already did, the interface's dialog too | rejected: pre-existing |
| blind | Search ignores no accents | low | Sure's `ILIKE` neither | rejected: parity |
| blind | Spec status and sprint status disagree; matrix counts accounts not bills | false | Mid-workflow states; one USD bill gives one account | rejected |
| blind, verification-gap | No test of the stored `inactive` after a pause, the band, `interval` → `custom`, `partiallyPaid` in reads, the `dueWithinDays` bound, `dormant`'s filter | medium | Each mutation named by the layer leaves every test green | patch: tests |
| blind, edge | `billHistory` and the write tools' answers read outside the write's transaction | low | A concurrent sync in a one-household instance; the write itself is one service call | rejected |
| edge | `update_bill` `active` accepts a suggestion or revives an ended bill | low | `ALLOWED_FROM` is the interface's « Reprendre »; Sure's tool sets `active` alike | rejected: parity |
| edge | `semimonthly` second day defaults to 15 | low | Sure's tool exposes no second day | rejected: parity |
| edge | `dueWithinDays` keeps ended or suggested bills with an old date | low | Only with `status` asking for them; Sure filters the same way | rejected: parity |
| edge | `leftOutFields` says every figure, counts include other currencies | low | Shared description | patch: `totals` describes it |
| standards | `create_bill` and `update_bill` call their write and then `billView`, two service functions (AD-19) | medium | `mcp/bills.ts` run bodies | patch: `billOf` formats the record the write returns |
| standards | `nextDueDates` and `cyclesOverdue` are pure date math in services | low | AD-1, AD-24 | patch: moved to `domain/recurring/bills.ts` |
| standards | `paused` ↔ `inactive` mapped in three places | low | `STORED_STATUS`, `lifecycleOf`, `updateBillTool` | patch: one map, `billStatusSchema` |
| standards | « Partially paid » computed twice; `settle` and `addManualPayment` insert alike | low | Two short expressions over different shapes | rejected |
| standards | `currency: string` in new types | low | Existing `BillRow` and `PriceChange` type it alike | rejected |
| standards | `billHistory` re-reads `schedulePinnedAt` | low | `RecurringRecord` does not carry it; adding it touches every recurring route | rejected |
| standards | `magnitude` and `billAmount` near twins | low | One describes an output, the other an input | rejected |
| spec | `closedCount` and `entryId` beyond the listed fields | low | `closedCount` keeps the twelve from reading as a lifetime total, as Sure's `history_window`; `entryId` is the patch above | rejected |

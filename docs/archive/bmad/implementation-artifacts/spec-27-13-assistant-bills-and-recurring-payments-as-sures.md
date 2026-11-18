---
title: "Story 27.13: Assistant bills and recurring payments as Sure's"
type: 'feature'
created: '2026-10-11'
status: 'done'
baseline_commit: '08c55c4c1bfd5f5abbadd8938540fe1d886556ab'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-27-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-27-12-assistant-reports-and-budgets-as-sures.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The six bill tools and `get_recurring_transactions` still answer Story 23.6's shapes: two-decimal strings (`"13.49"`), `amount_min`/`amount_max`, `category` as `{ id, name }`, `null` fields Sure leaves out, reporting-currency totals with `left_out_*`, no `analytics`, `closed_occurrences` where Sure says `history`, accounts taken by id, input keys as `changed_fields`, signed recurring amounts with a `merchant`, and a `status: "all"` that still hides ended series. Sure's functions (`origin/main` `275f2f994`; the seven files are unchanged since `00dd977fb`) answer otherwise.

**Approach:** Each tool answers and refuses as its Sure function, key by key and in Sure's key order, with 27.9's `formatMoney` and Sure's `{ error, hint }` refusals (Sure's `BillsSupport` has no `success` key). Figures keep coming from the bill and recurring services; services change only where Sure's answer needs a figure they do not give (per-currency totals, analytics, an unfiltered `all`).

## Boundaries & Constraints

**Always:**
- Shared bill (`serialize_series`, nil keys left out): `id`, `name`, `bill_type`, `status` (`"paused"` for `inactive`), `amount` (`formatMoney` of the magnitude), `currency`, `frequency` (`"custom"` outside the presets), `next_due_date`, `autopay`, `detected_automatically`, `category` (name), `account` `{ id, name }` (left out without an account), `monthly_equivalent` (formatted magnitude), `payment_url`. `amount_min`/`amount_max` go. `destination_account` waits for Story 27.24.
- Occurrence (`serialize_occurrence`): `due_on`, `effective_due_on`, `state` (27.2's), `expected`, `paid`, `remaining` formatted, `partially_paid`.
- `get_bills`: `as_of_date`, `total_results`, `truncated`, `family_currency` (reporting currency), `bills` (each with `current_occurrence`, `null` allowed), `totals { active_count, overdue_count, active_monthly_equivalent_by_currency }` summed per currency over every match, active non-income bills, each sum rounded once as 27.3; `totals.currency` and `left_out_*` go. With nothing matched and no `payment_state`, `search` or `due_within_days`, Sure's `hint` naming the other stored statuses' counts (`"Nothing matched status active, but this family has 2 suggested, 1 inactive. Call get_bills again …"`). Unknown `status`, `bill_type`, `payment_state` answer `{ error: "<v> is not a valid <field>", hint: "Valid values: …." }`; `due_within_days` outside 1–365 or not whole answers Sure's message.
- `get_bill_details`: `bill` = shared bill + configuration (nil keys left out): `amount_strategy` `"fixed"`, `weekend_adjust` `"none"`, `end_mode` (`"after_count"` with `end_after_count`, else `"never"`), `end_after_count`, `anchor_date`, `notes`, `schedule_pinned`, `expected_amount_min`/`_max`/`_avg` formatted magnitudes. `notify_days_before`, `overdue_grace_days`, `end_on`, `trial_ends_on`, `renews_on`, `cancelled_on` are absent, as Sure's `.compact` leaves a default bill's. Then `analytics` (`null` before a paid occurrence): `average_paid`, `lowest_paid`, `highest_paid` over each paid occurrence's confirmed sum, `annualized_cost` (average × `occurrencesPerYear`), `annualized_declared` (monthly equivalent × 12), `paid_this_year` (confirmed payments since 1 January, any occurrence), all formatted, each rounded once from exact integers; `open_occurrences`; `history` (closed, latest first, 12) each with `status` and `payments [{ amount, paid_on, source, state, transaction_name }]` (the line's label, left out when none); `history_window { count, truncated }`; `upcoming_due_dates`; `price_changes [{ effective_on, previous_amount, new_amount, percent_change, source: "detected" }]`; `price_change_window { months: 24, count }`. `closed_occurrences`, `closed_count`, `transaction_id`, `transaction_label` go.
- `get_bill_audit`: `as_of_date` then eight sections `{ items, truncated, count }`: `possible_duplicates { name, amount, bills [{ id, account (name, `null` without one) }] }`, `price_changes { bill, bill_id, effective_on, previous_amount, new_amount, percent_change }`, `upcoming_trials` and `upcoming_renewals` always empty, `long_overdue { bill_id, name, cycles_overdue, next_due_date, amount }`, `dormant { bill_id, name, status: "paused" }`, `awaiting_confirmation { bill_id, name, amount }`, `undeclared_candidates { name, average_amount, occurrence_count, last_seen }`. `currency`, `due_day`, `account` refs and `entry_id` go. `lookback_months` loose, Sure's message outside 1–24.
- Writes take Sure's parameters: `account_name`, optional in `create_bill` as Sure's: without it the bill is paid from any account, Story 27.27's (exact, case included; none → `No account named "X" that you can add bills to`, two → `More than one account is named "X"`, Sure's hints), `amount` a JSON number or decimal string through `sureDecimalText`, `frequency` in Sure's presets (else Sure's `is not a frequency this app recognizes`), `bill_type` among `bill`, `subscription`, `installment`. `account_id` and `entry_id` go. `create_bill`'s `is_income` and `autopay` read through Sure's allowlist (`true`, `"true"`, `"t"`, `"1"`, `1` and their false twins), else `<key> must be true or false`.
- `create_bill` answers `{ created: true, bill, upcoming_due_dates }`; a service refusal answers `{ error, hint: "Fix the named fields and retry once." }`.
- `update_bill` applies Sure's steps in Sure's order (simple fields, `bill_type`, `amount` (magnitude, abs), account, category, status, schedule), the first refusal changing nothing, each with Sure's message; `"other"` or `"income"` series cannot change kind; day fields without `frequency` refused as Sure's; nothing to change → `No recognized fields to change`. `renews_on` and `trial_ends_on` are accepted names and refused: `{ error: "<key> is not kept by Archant yet", hint: "Do not retry. Tell the user renewal and trial dates are not tracked." }`. Answer `{ updated: true, changed_fields, bill }`, `changed_fields` Sure's attribute names in step order: `name`, `autopay`, `payment_url`, `notes`, `bill_type`, `amount`, `account`, `category`, `status`, `schedule`.
- `record_bill_payment` answers `{ recorded: true, bill: <display name>, occurrence: { …occurrence, status } }`; refusals Sure's: `has nothing owed right now` (with its next due date), `No open occurrence of <name> is due on <date>` (with up to six open dates), `has no open occurrence to pay`, `amount is not a number`, `amount must be greater than zero` (a negative refused), `<amount> is more than the <remaining> still owed on the cycle due <date>`, `paid_on is not a valid date`, `occurrence_due_on is not a valid date`.
- Every bill tool: an id that is not a UUID → `bill_id is not a valid id`; an unknown one → Sure's tool caller answer `No such record, or it is not one you have access to` with its hint.
- `get_recurring_transactions`: `as_of_date`, `total_results`, `truncated`, `recurring_transactions`, `totals_by_currency`. Each row (nil keys left out): `id`, `name`, `amount` (`formatMoney` in Sure's sign: an expense positive, an income negative), `expected_amount_range` (`[min, max]` formatted in Sure's sign), `currency`, `status` (stored value), `expected_day_of_month`, `next_expected_date`, `last_occurrence_date`, `occurrence_count`, `is_manual`, `is_transfer` (`false` until 27.24), `account { id, name }`. `merchant` goes. Rows by status then next date, as Sure's `order(status: :asc, next_expected_date: :asc)`. `status` loose: `"all"` filters nothing, ended and suggested included; anything unknown reads `"active"`. `upcoming_within_days` read as Ruby's `to_i`, clamped 1–365. `totals_by_currency`: active, non-transfer series of the matched set, Sure's sign, formatted.
- Docs: AD-19 (`docs/architecture.md`) says the bill tools take an account by exact name, refusing a shared one, and that `record_bill_payment` reads the bill after a refusal to word it; only 27.14 still answers earlier fields. `INSTRUCTIONS` (`mcp/server.ts`), `docs/security-model.md` « Assistants », `docs/deployment.md` « Connecting an assistant », `docs/sure-parity.md` rows « Assistant tools for bills » and « Assistant tools » follow, with each departure named.

**Never:** no migration (Story 27.27 brings the account-less bill); no change to « Factures », « Récurrents », `routes/bills.ts`, `routes/recurring.ts` or what `listRecurring(deps)` returns to the page; no `amount_strategy`, notice or grace column; no subscription dates (Later); no `get_paycheck_plan`; no recurring transfer (27.24); no change to the reports, budgets, goals, imports or transfers tools.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Two currencies | active 13,49 € and 10 USD bills | `active_monthly_equivalent_by_currency: { EUR: "13,49 €", USD: "10,00 $" }` | none |
| Nothing active | 2 suggested only | `bills: []`, `hint` naming `2 suggested` | none |
| No account | `create_bill` without `account_name` | a bill paid from any account, in the reporting currency, no `account` key | none |
| Namesake | two accounts « Compte courant » | nothing written | `More than one account is named "Compte courant"` |
| Number amount | `create_bill` `amount: 13.49` | bill at 1349 minor units, `amount: "13,49 €"` | none |
| Yearly | `frequency: "yearly"` | nothing written | Sure's frequency message |
| Retry settle | current cycle paid, next upcoming | nothing written | `… has nothing owed right now` |
| Over remaining | 1 500 € on 1 000 € left | nothing written | `1 500,00 € is more than the 1 000,00 € still owed …` |
| Recurring salary | income 2 000 € | `amount: "-2 000,00 €"` | none |
| Recurring all | an ended series | listed with `status: "ended"` | none |

**Decision (owner, 2026-10-11):** « On s'aligne toujours sur Sure »: `create_bill` takes no account as Sure's; the account-less bill itself is Story 27.27, built before this one.

</frozen-after-approval>

## Code Map

- `packages/api/src/mcp/bills.ts` -- six tools. `billOutput`/`billOf` become Sure's `serialize_series` (`formatMoney`, `category` name via `names.categories.get`); `occurrenceOf` formats; `priceChangeOutput` splits into the details and audit shapes; `magnitude`, `positive`, `categoryOf` reshaped; `leftOutFields`/`leftOutOf` leave. Sure: `app/models/assistant/function/{bills_support,get_bills,get_bill_details,get_bill_audit,create_bill,update_bill,record_bill_payment}.rb`.
- `packages/api/src/mcp/recurring.ts` -- `rangeOf`, `totalsByCurrency` in Sure's sign, `formatMoney`; Sure: `get_recurring_transactions.rb`.
- `packages/api/src/mcp/tool.ts` -- `formatMoney:270`, `sureDecimalText:365`, `ToolRefusal:186` (`{ error, hint }` body already typed; add a `refuseWithHint(error, hint, outcome)`), `leftOutFields:130`/`leftOutOf:141` (delete if bills were their last user, knip says), `decimal:126` (still used by goals, imports, transfers).
- `packages/api/src/schemas/assistants.ts:1078-1260` -- bill inputs: `account_name`, `sureAmount` (`:55`), loose `status`/`bill_type`/`payment_state`/`due_within_days`/`lookback_months`/booleans/`frequency` checked in `run` in Sure's order; `updateBillInput`'s `superRefine` (`empty_patch`, `requires_frequency`) moves to the tool to answer Sure's messages; `:247` `recurringInput` loose.
- `packages/api/src/services/recurring/bill-reads.ts:142` `findBills` -- totals per currency, `leftOut` and `currency` go; `:231` `billHistory` adds `analytics` (from `allocations` it already loads, `occurrencesPerYear` in `domain/recurring/schedule.ts:239`, `monthlyEquivalent:292`), keeps `expectedAmountAvg`; all three are tool-only.
- `packages/api/src/services/recurring/audit.ts:66` `billAudit` -- unchanged figures; the tool reshapes.
- `packages/api/src/services/recurring/series.ts:582-620` `VIEW_STATUSES`/`listRecurring` -- with a filter, `all` drops the status test and the `ended` exclusion; without one (the page), unchanged; order by status text then next date for the tool only.
- `packages/api/src/services/recurring/payments.ts:640-705` `recordBillPayment` -- refusals unchanged (`NOT_FOUND`, `not_due`, `exceeds_remaining`); the tool catches them and reads `billHistory` for the name, open dates and remaining.
- `packages/api/src/services/recurring/bills.ts` `declareBill`, `updateBill` -- unchanged; `displayName` reused.
- `packages/api/src/services/names.ts:87` -- add `accountsNamed(deps, name)` returning at most two ids, exact name. After 27.27, `declareBill` and `updateBill` take `accountId: null`; `billOf` leaves `account` out then.
- `packages/api/src/mcp/server.ts:146,185-187` -- `INSTRUCTIONS`.
- Tests: `mcp/bills.spec.ts`, `mcp/server.spec.ts` (recurring and bill cases), `services/recurring/bill-reads.spec.ts`, `series.spec.ts`, a new `services/names.spec.ts` for `accountsNamed`, `mcp/transfers.spec.ts:265` comment.
- Docs: `docs/architecture.md:201`, `docs/security-model.md:85`, `docs/deployment.md:321,337`, `docs/sure-parity.md:226,252`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/mcp/bills.spec.ts`, `mcp/server.spec.ts` -- failing first: every matrix row, `Object.keys` of each answer, bill, occurrence, history row, payment, section item and recurring row in Sure's order, absent nil keys, each refusal's text and order.
- [x] `packages/api/src/services/recurring/bill-reads.ts`, `bill-reads.spec.ts` -- per-currency totals; analytics with paid, partly paid and unpaid occurrences, a payment last December, rounding of a three-way average.
- [x] `packages/api/src/services/recurring/series.ts`, `series.spec.ts` -- `all` with a filter lists ended and suggested; the page's call unchanged.
- [x] `packages/api/src/services/names.ts` -- `accountsNamed`.
- [x] `packages/api/src/schemas/assistants.ts`, `mcp/bills.ts`, `mcp/recurring.ts`, `mcp/tool.ts` -- inputs, answers, refusals.
- [x] `packages/api/src/mcp/server.ts` -- `INSTRUCTIONS`: accounts by exact name in the bill tools, amounts formatted.
- [x] Docs as Boundaries list; `sprint-status.yaml` key `27-13-assistant-bills-and-recurring-payments-as-sures`.

**Acceptance Criteria:**
- Given `pnpm test`, when both Vitest projects run, then they pass and the seven tools are pinned key by key through the MCP handler.
- Given `pnpm lint:code`, when knip runs, then nothing this story leaves unused remains.
- Given « Factures » and « Récurrents », when they load, then they show what they showed before this story.

## Design Notes

Sure's `analytics` average is `BigDecimal` sum / count, then `Money.new` rounds; `annualized_cost` multiplies the unrounded average. Keep the exact fraction (sum, count) and round half up once per figure, as 27.12's `percentDecimal` does.

`expected_amount_range` in Sure's sign swaps the bounds: Sure's min of an expense is `-max` in Archant's sign.

`get_bills` keeps Archant's search of the label beside the name and merchant: Archant's display name falls back to the label, where Sure's series always carries a name or a merchant.

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck` -- expected: clean.
- `pnpm test` -- expected: both Vitest projects pass.
- `pnpm test:e2e` -- expected: green.

## Implementation Notes

- `findBills` returns `familyCurrency`, `totals.activeMonthlyByCurrency` (each currency's `monthlyRollup`, in the order the bills first name it) and `elsewhere`, Sure's `other_status_hint` counts, read only when nothing matched, no other filter narrowed and the status is not `all`. `currency` and `leftOut` are gone, and so are `leftOutFields`, `leftOutOf` and `accountRefOf` in `mcp/tool.ts`, bills being their last user.
- `billHistory` adds `analytics`, from the allocations it already loads, and `bill.expectedAmountAvg`. `annualized_cost` comes from `annualizedAverage` (new in `domain/recurring/schedule.ts`): the exact fraction `12 × monthlyFraction(rules, total) / count`, rounded once, so the float of `occurrencesPerYear` never touches money.
- `update_bill` reads the bill first through `billView`, now exported, to refuse in Sure's steps (the bill's kind, its name in the message) and to ask `applyFrequency` whether the cadence changes, as Sure's `FrequencyPreset.apply`: the cadence a bill already has changes nothing, so alone it answers `No recognized fields to change`.
- `record_bill_payment` checks its formats in the tool; on any refusal, its own or the service's (`NOT_FOUND`, `not_due`, `exceeds_remaining`), it reads `billHistory` to word it and to answer the occurrence's refusal first, in Sure's order. The occurrence's raw `derivedState` says whether it is owed, as Sure's, not the paused state the tools show.
- `recordBillPayment` returns the bill's `billName`, for Sure's `bill` key. `displayName` moved to `domain/recurring/bills.ts`: `payments.ts` importing it from `services/recurring/bills.ts` closed an import cycle.
- `categoryIdsOf` is gone: the bill tools find a category by its exact name through `idsNamed`; `update_bill` then reads « Uncategorized », « Non catégorisé » or « Sans catégorie » as none (Story 27.12's decision), `create_bill` refuses them as Sure's. `accountsNamed` (new in `services/names.ts`) gives at most two ids of an exact account name, among the active accounts alone, as the bill dialog offers them.
- `create_bill` words its own refusals with Sure's English `recurring_transactions.create` messages (`Enter the amount as a plain number`, `Enter the bill's next due date`, `This bill already exists`); another service refusal names each field and code. A negative amount is taken as its magnitude, as Sure's `DeclaredBill` takes `.abs`.
- `get_bills` refuses a `bill_type` outside Archant's `BILL_TYPES`, `transfer` included until Story 27.24.
- `listRecurring` with a filter orders by stored status then next date; `all` drops the status test and the `ended` exclusion. The page's call, without a filter, is unchanged.

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Evidence | Route |
|---------|---------|----------|-------|
| Weekday 0 read as invalid, an unchanged Sunday schedule counted as a change (edge) | medium | `changesSchedule` refuses `number === 0` for every day field. | patch |
| `formattedOf`/`magnitudeOf` take a bare `number`; `overRemaining` falls back to `0` (blind, edge, standards) | medium | AGENTS.md money rule; an unparsable amount would read « 0,00 € is more than… ». | patch |
| `accountsNamed` finds deactivated accounts (blind, edge) | medium | The dialog offers active accounts only; a hidden namesake blocks the active one. | patch |
| `transaction_name`, `update_bill` `autopay: "false"` and negative amount, suggested allocations in analytics, non-monthly `annualized_cost`, recurring totals under `all` untested (verification-gap, blind) | medium | Each mutation the reviewer describes passes today's suite. | patch |
| AD-19 says `record_bill_payment` reads the bill after a refusal; it also reads before refusing a bad date (standards) | low | Code reads on the refusal path only. | patch: AD-19 wording |
| `get_bills` hint names stored `inactive`, which `status` refuses (blind, edge) | false | Sure's `other_status_hint` groups the stored `status` too: same words. | rejected |
| `create_bill` silently ignores an unknown `bill_type` (blind) | false | Sure's `presence_in` ignores it the same way. | rejected |
| `search` no longer trimmed or bounded (blind) | low | Sure's `ILIKE %search%` neither trims nor bounds. | rejected |
| `entry_id` gone from `create_bill` and the audit (blind) | low | Decided in the frozen block: Sure has neither. | rejected |
| `paid_this_year` has no upper bound (blind) | false | Sure's `paid_on >= beginning_of_year` has none either. | rejected |
| `update_bill` `account_name: null` answers « No account named nil » (blind) | false | Sure's `apply_account` answers the same. | rejected |
| `update_bill` `autopay: ""` turns autopay on (blind, edge, spec) | low | Rails casts it to `nil` and the save fails; no assistant sends a blank flag. | rejected |
| Ruby `Integer()` octal and hex forms (blind, edge) | low | `"010"` or `"0x10"` are never a day count an assistant sends. | rejected |
| `get_recurring_transactions` `name` falls back to the label (edge, spec) | low | As `get_bills` (Design Notes); Sure leaves the key out for a series it would not name. | rejected |
| `create_bill` drops an income's category, Sure keeps it (blind, spec) | low | `declareBill` clears it for every income, the dialog's rule since Story 23.2; a service change outside this story. | defer |
| `accountRefOf` removed then inlined twice, `FALSE_INPUTS` beside `RAILS_FALSE`, `listRecurring` branching twice (standards) | low | Two call sites; two lists match two different Sure casts. | rejected |
| `record_bill_payment` `bill` from a merchant untested (verification-gap) | low | `displayName` is pinned on the read side. | rejected |
| Epic text still says `null` for subscription dates (spec) | low | The frozen block follows Sure's `.compact`. | patch: `epics.md` |

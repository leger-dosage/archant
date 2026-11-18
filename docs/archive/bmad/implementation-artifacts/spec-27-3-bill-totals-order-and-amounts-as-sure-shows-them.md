---
title: 'Story 27.3: Bill totals, order and amounts as Sure shows them'
type: 'bugfix'
created: '2026-10-09'
status: 'done'
baseline_commit: 'bdab84e162c4acbe2343506a3e67f815edc8de50'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-27-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `monthlyEquivalent` rounds each series to the cent before the subscription rollup sums them and multiplies by 12, so a 10 € weekly bill reads 521,76 € a year where Sure reads 521,79 €. « Toutes les factures » sorts paused before ended and sorts names on the display name with the largest outflow first; a moving amount reads as its band in the list and on « À venir », where Sure shows one amount and keeps the band for the drawer and the wide occurrence line.

**Approach:** Sure at `00dd977fb`: `load_subscription_rollup` sums unrounded `monthly_equivalent_amount`s and multiplies by 12 before `format_money` rounds; `load_all_series` orders by the `status` string then `next_expected_date`, or `order(:name, :amount)`; `all.html.erb` shows `amount.abs` and « X/mois »; `_projected_transaction` shows one amount; `_summary` and `_occurrence` show « ~ » and the band when `occurrence_amount_estimated?` and `has_amount_variance?`.

## Boundaries & Constraints

**Always:**
- One domain function in `domain/recurring/schedule.ts` sums series as exact fractions of minor units and rounds `monthly` and `annual = 12 × sum` once each, half up; `monthlyEquivalent` keeps its per-series result and shares the fraction. `subscriptionRollup` and `findBills`' `activeMonthly` call it. A 10 € weekly bill: 43,48 € a month, 521,79 € a year.
- `due` sort: `active`, `ended`, `inactive`, then `nextExpectedDate`, then `id`.
- `name` sort: the stored `name` through the existing `byName` collator, series with a null `name` last, then amount ascending in Sure's sign (Archant's `b.amount - a.amount`: an income first, then the smallest outflow), then `id`. The row still shows `displayName`.
- « Toutes les factures »: the signed amount, then « X/mois » (`bills.allView.perMonth`, Sure's fr `monthly_equivalent`, no « ≈ ») when the monthly equivalent differs, as today.
- « À venir »: one signed amount, `expectedAmountAvg` for a manual series that has one, else `amount`, as `_projected_transaction`.
- Estimated amount = the occurrence has no `expectedAmount` of its own and the series' `expectedAmountMin < expectedAmountMax`; Archant has no `amount_strategy`, so every series is Sure's default `fixed`.
- Occurrence line of `/bills`: an estimated expected amount reads « ~ » before it, and from Sure's `@lg` container width the line below reads « varie de {min} à {max} » (`recurring.amountRange`), magnitudes ascending.
- Bill drawer « Prochain paiement » (Sure's `_summary`): a scheduled current occurrence keeps its remaining amount, plus the band line when estimated; otherwise « ~ » when the series varies, then `|amount|`, with no band line.
- `docs/sure-parity.md` « Bills page, all bills, bill drawer » and « Upcoming tab on transactions » read Parity, Story 27.3; foreign-currency conversion in the rollup stays Later.

**Never:** no `amount_strategy` column; no change to `get_bills`' or `get_bill_details`' fields other than the value of `active_monthly_equivalent` (Story 27.13); no change to the suggestions' `RecurringAmount`; no paid headline, autopay, notes or recurring-transfer display (27.24); no conversion of other currencies.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected |
|---|---|---|
| Weekly total | one active subscription, 10 € weekly | « Par mois » 43,48 €, « Par an » 521,79 € |
| Two series | 10 € weekly and 9,99 € monthly | monthly = round(43,4821… + 9,99) = 53,47 €; annual = round(521,7857… + 119,88) = 641,67 € |
| Status order | active, ended, inactive series | listed active, ended, inactive |
| Name order | « Eau » 30 €, « Eau » 12 €, unnamed (merchant « Free ») | Eau 12 €, Eau 30 €, then Free |
| Moving bill, list | min 40 €, max 60 €, amount 52 € | « −52,00 € », no band |
| Moving bill, line | open occurrence without own expected amount | « ~52,00 € », band from `@lg` |
| Fixed by occurrence | same, occurrence `expectedAmount` set | no « ~ », no band |
| Upcoming, manual | manual series, avg 50 €, amount 52 € | « −50,00 € » |

</frozen-after-approval>

## Code Map

- `packages/api/src/domain/recurring/schedule.ts:258-283` -- `monthlyEquivalent`; extract the fraction, add the summing function beside it.
- `packages/api/src/services/recurring/bills.ts:1149-1171` -- `STATUS_RANK`, `SORTS`; `:1035` `displayName`; `:1219-1244` `subscriptionRollup` (rows carry `rules`); `:600-622,762,820` `BillRow` and `loadBills`, which reads the occurrence's `expectedAmount` and can select the series' band: add `amountRange: { min, max } | null`, non-null only when estimated.
- `packages/api/src/services/recurring/bill-reads.ts:175-179` -- `activeMonthly`.
- `packages/app/src/components/AllBills.tsx:336` -- `RecurringAmount` → `<Money signed>`.
- `packages/app/src/components/UpcomingRecurring.tsx:79` -- same, with the manual average.
- `packages/app/src/routes/_authed.bills.tsx:81-130` -- `rowAmount`, `BillRow`: « ~ » and the band; the list needs `@container`.
- `packages/app/src/routes/_authed.bills.$billId.tsx:94-129` -- `NextPayment`.
- `packages/app/src/components/RecurringSuggestions.tsx:32` -- `RecurringAmount`, kept for suggestions.
- `docs/sure-parity.md:219-220`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/domain/recurring/schedule.spec.ts` -- failing first: weekly total 4348 / 52179, the two-series row, `monthlyEquivalent` unchanged.
- [x] `packages/api/src/domain/recurring/schedule.ts` -- the summing function.
- [x] `packages/api/src/services/recurring/bills.spec.ts` -- failing first: rollup at `:1271` with a weekly bill; status order; name order with an unnamed series and two « Eau »; `billsOverview` `amountRange` for estimated, fixed-by-occurrence and steady rows.
- [x] `packages/api/src/services/recurring/bill-reads.spec.ts` -- failing first: `activeMonthly` rounded once.
- [x] `services/recurring/bills.ts`, `bill-reads.ts` -- sorts, rollup, `amountRange`.
- [x] App files of the Code Map -- the displays.
- [x] `packages/app/e2e/bills.spec.ts` -- rollup values recomputed; a moving bill reads one amount in « Toutes les factures », « ~ » on its line and its band in the drawer. `recurring.spec.ts:200-206` -- the list row reads the amount; the suggestion keeps its band. `transactions.spec.ts` « À venir » follows.
- [x] `docs/sure-parity.md` -- the two rows.

**Acceptance Criteria:**
- Given a moving bill, when the owner opens « Toutes les factures », `/bills` at 1280 px and 375 px, and the drawer, then screenshots show one amount in the list, « ~ » and the band only at the wide width, and the band in the drawer, checked in self-review.
- Given the finished story, when `pnpm test` and `pnpm test:e2e` run, then both pass.

## Design Notes

Sure's `BigDecimal * Float` and Archant's exact fraction agree to the cent except at a half-cent tie Sure's float may miss; integer minor units are an admitted departure. The story's « ≈ X/mois » and a monthly line on « À venir » are not Sure's: `fr.yml` reads `%{amount}/mois`, and `_projected_transaction` shows one amount, so the spec follows Sure.

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck` -- expected: clean.
- `pnpm test` -- expected: both Vitest projects pass.
- `pnpm test:e2e` -- expected: all five Playwright projects pass.

## Implementation Notes

- `monthlyRollup` in `schedule.ts` sums `monthlyFraction`s exactly; `monthlyEquivalent` rounds the same fraction for one series.
- `amountRange` rides on `BillRow` and `BillOccurrence`, set by `estimatedRange`; the tools pick their fields one by one, so it never reaches `get_bills` or `get_bill_details`.
- « À venir » gets `projectedAmount` from one extra read of the averages over the same window, `manual = true`, since `RecurringRecord` carries no average.
- `AmountRange` in `BillLabels.tsx` renders the band for the occurrence line and the drawer; `RecurringAmount` stays private to the suggestions.
- The « Prochaine » cards also read « ~ » through `RowAmount`, as Sure's `_month_pulse.html.erb:109`.
- `nullableMinor` from `services/recurring/series.ts` is exported and reused, so `estimatedRange` takes `MinorUnits`.
- QA: before and after captures of the subscription rollup (641,64 € → 641,67 € for 10 € weekly plus 9,99 € monthly), « Toutes les factures » (band → « −52,00 € »), the occurrence line at 1280 px (« ~52,00 € » and the band) and 375 px (« ~52,00 € » alone), and the drawer (band under the next payment).
- Seen in QA, not caused by this story: a series added from a detected row keeps that row's month unpaid and overdue, before and after the change.

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Evidence | Route |
|---|---|---|---|
| `upcomingRecurring` re-reads the series in chunks for `expectedAmountAvg` | low | Real: the rows were just selected; one read with the same window suffices. | patch |
| Name-order test has no income beside outflows of one name | low | Real: the sign inversion `b.amount - a.amount` is untested for an income. | patch |
| No Playwright row where « À venir »'s average differs from the amount | low | Real gap, but the API cannot declare a manual series whose average differs; `bills.spec.ts` pins `projectedAmount` and the component passes it straight to `Money`. | rejected |
| `transactions.spec.ts` « À venir » unchanged though the task names it | false | The task says it follows: its declared bills have no band, so it passes unchanged. | rejected |
| Drawer's no-occurrence « ~ » branch untested end to end | low | Real; one `varies` test and the matrix rows are pinned on the scheduled branch and in `amountRange`. Adding a paused moving bill to e2e costs a detection fixture. | rejected |
| « ~ » on « Prochaine » cards is outside the spec | false | Sure's `_month_pulse.html.erb:109` writes it; the cards are Sure's month pulse. | rejected |
| « ~ » cards untested | low | Same `RowAmount` as the list rows the e2e checks. | rejected |
| Variance rule computed client-side in `NextPayment` and server-side in `estimatedRange` | low | Two one-line comparisons of the same fields; `RecurringAmount` already did it client-side. | rejected |
| « ~ » has no screen-reader text | low | Sure renders the same bare « ~ »; no admitted reason to depart. | rejected |
| e2e locates the row through `data-slot` and `data-status` | low | `splits.spec.ts` and Story 27.2's test read the same attributes. | rejected |
| `monthlyRollup` denominators grow with each series | low | A household's few dozen series give integers of a few hundred bits; exactness holds. | rejected |
| `toSorted` with non-null assertions in `estimatedRange` | low | Style only. | rejected |
| Parity row mentions sorts twice; table reflowed | low | The second mention is about the URL; the reflow is Prettier's table width. | rejected |
| Spec `in-review` while sprint status reads `in-progress` | false | Step 5 syncs the sprint status. | rejected |
| Captures for the 1280 px and 375 px check absent | false | The QA pass captures them before the pull request. | rejected |
| Editing a manual series' amount leaves a stale `expectedAmountAvg` in « À venir » | false | Sure's `_projected_transaction` reads the same running average (`recurring_transaction.rb:684-700`), which an edit does not reset either. | rejected |
| `estimatedRange` takes money as bare `number` (AGENTS.md « Money is never a float ») | medium | Real: `loadBills` passed raw integers. | patch: `MinorUnits` parameters, `nullableMinor` at the call sites |
| Band markup duplicated in `BillRow` and `NextPayment` | low | Real: two identical blocks. | patch: `AmountRange` in `BillLabels.tsx` |
| `upcomingRecurring` still reads the averages in a second query | low | One read now; adding the average to `recordColumns` would widen every `RecurringRecord` payload. | rejected |

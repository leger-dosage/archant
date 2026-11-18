---
title: 'Story 24.2: The amortisation schedule'
type: 'feature'
created: '2026-10-07'
status: 'done'
route: 'dispatch'
baseline_commit: '91586aa78b3db622510d276c31a40114cc3796d4'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-24-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 24.1 records a loan's terms, but nothing turns them into what each payment repays: the owner cannot read his loan's schedule beside his bank's table.

**Approach:** Port Sure's loan engine, read at `14638a701` (`app/models/loan/amortization_math.rb`, `simulator.rb`, `simulation_result.rb`, `rate_resolver.rb`, `amortization_schedule.rb`, `insurance.rb`), to pure functions in `packages/api/src/domain/loans/`, computed on read by one service behind `GET /api/accounts/:id/schedule`, and show it in an « Échéancier » tab as Sure's `loans/tabs/_schedule`. Story 24.2 of `epics.md` is the acceptance contract; this spec adds what reading Sure settled.

## Boundaries & Constraints

**Always:**
- Exact `BigInt` fractions; interest, payment and premium round half up, away from zero, to the minor unit, as `BigDecimal#round`. Monthly rate = rate (millionths) / 12 000 000.
- A schedule exists when the account is a loan with `originalAmount > 0`, `rateType`, `interestRate` and `termMonths` (1–1 200) set, and an origination date: `startDate`, else the opening anchor (`openingDateOf`). Never a fallback principal; the down payment is not subtracted, as Sure's.
- `RateResolver`: a fixed rate answers `interestRate` for every date; `variable` or `adjustable` answers the latest `rateChanges` row effective on or before the date, else `interestRate`. Re-amortisation events are the changes within [first payment, last payment], both inclusive.
- `Simulator` ports `reamortize` and `scheduled` (callable payment, `settleAtScheduleEnd`), `level_payment` with `first_period_interest` when accrual and sizing rates differ, `step` with `final`, the early stop at a zero balance, `converged`, `balloonAmount`; it throws on an empty schedule or more than 1 200 periods. `hold` and the `reamortize` seed have no caller and are not ported.
- `reAmortising` is true when two consecutive payments have different sizing rates; `periodicPayment` is the first payment; `totalPaid` sums payments.
- `Insurance`: no premiums without a positive rate; `level_term` charges the amount borrowed, anything else (decreasing or none) the opening balance of the period, as Sure's. Domain only in this story: Story 24.3 shows it.
- Response `{ data: null }` for a non-loan or a loan without a schedule, `NOT_FOUND` for an unknown account; otherwise `asOf` (today in `APP_TIMEZONE`), `currency`, `originationDate`, `variable`, `reAmortising`, `periodicPayment`, `totalInterest`, `totalPaid`, `payments: { number, date, payment, principal, interest, endingBalance }[]`, amounts as `MinorUnits`. A viewer reads it.
- Tab `schedule`, « Échéancier », after « Soldes », only when the answer is not null; a link to it otherwise opens « Opérations », as « Positions » does. Cards via `SummaryStrip`: « Mensualité » or « Première mensualité » when `reAmortising`, « Intérêts totaux », « Coût total ». Then the sentence of the acceptance criteria with the long French date, the variable notice, and a table « N° », « Date » (long), « Mensualité », « Capital », « Intérêts », « Capital restant dû », rows with `date <= asOf` shaded and `data-past`.

**Never:** no stored figure, no migration, no « Fin prévue » card, projection, overview or chart (24.3, 24.4), no MCP tool or export change, no new error code, no premium in the response.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected |
|---|---|---|
| ING | 13 000 000, 18200, 300, 2020-12-05, fixed | 53 969; #69 2026-09-05 → 10 510 482; #70 38 028 + 15 941 → 10 472 454; #300 2045-12-05 53 965; interest 3 190 696; paid 16 190 696 |
| ING premium | 2917, `level_term` | 3 160 each, total 948 000 |
| Decreasing | same, `decreasing_life` | premium n = round(opening balance n × 2917 / 12e6) |
| Month end | start 2026-01-31 | 2026-02-28, 2026-03-31 |
| Zero rate | 100 000, 0, 10 | 10 000 each, no interest |
| Early clear | 1 000, 0, 51 | 50 payments |
| Change between payments | 500 000,00, 6 % → 18 % on 2026-06-20, 24 months from 2026-01-01 | #6, on 2026-07-01, accrues 6 %, sized with first-period interest; final within 1,00 € of it |
| Change on first payment | change on 2026-02-01 | first payment sized at the new rate, not re-amortising |
| Same rate again | change to the base rate | not re-amortising |
| Fixed with changes | fixed, rows kept | changes ignored |
| No schedule | no amount, no rate type, or no origination | `null`, no tab |

</frozen-after-approval>

## Code Map

- `packages/api/src/domain/dates.ts:96` -- `addMonths` clamps to the month's end, as Ruby's `>>`; reuse for payment dates.
- `packages/api/src/domain/recurring/` -- layout to copy: one module per Sure class, co-located specs, 100 % branches (`packages/api/vitest.config.ts:29`).
- `packages/data/account-types.ts:119` -- `LoanDetails`, `MAX_LOAN_TERM_MONTHS`, rate types.
- `packages/data/money.ts` -- `MinorUnits`, `toMinorUnits` at the service boundary.
- `packages/api/src/services/holdings.ts:69` -- `listPositions`: shape of a read service (`getAccount` from `services/accounts.ts:13`, `today(deps.timeZone)`).
- `packages/api/src/services/ledger/balances.ts:418` -- `openingDateOf(deps, accountId)`.
- `packages/api/src/routes/accounts.ts:76` -- `.get("/:id/holdings")`; add `.get("/:id/schedule")` beside it.
- `packages/api/src/routes/accounts.spec.ts:2010` -- holdings GET spec; viewer pattern from 24.1's tests.
- `packages/app/src/hooks/useHoldings.ts`, `lib/query-keys.ts:35` -- hook and key pattern; add `useLoanSchedule` and `queryKeys.accounts.schedule(id)`.
- `packages/app/src/routes/_authed.accounts.$accountId.tsx:61,405-420,548-612` -- `ACCOUNT_TABS`, the « Positions » gating, tab triggers and panels.
- `packages/app/src/components/PositionList.tsx`, `SummaryStrip.tsx`, `Money.tsx`, `ui/table.tsx` -- table, cards, amounts.
- `packages/app/src/lib/dates.ts:66` -- `otherYear` formatter; export a `longDate(iso)` helper.
- `packages/app/src/locales/fr.json` -- new `loanSchedule` keys.
- `packages/app/e2e/accounts.spec.ts:251`, `fixtures.ts:188` -- ING test and `api.openAccount({ details })`.
- `docs/sure-parity.md:61`, `_bmad-output/planning-artifacts/ux-designs/ux-archant-2026-09-21/EXPERIENCE.md:29` -- Loan row, account detail tabs.

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/domain/loans/amortization-math.spec.ts`, `amortization-math.ts` -- `roundHalfUp`, `levelPayment`, `step` -- red first.
- [x] `packages/api/src/domain/loans/simulator.spec.ts`, `simulator.ts` -- Sure's simulator tests ported, both strategies.
- [x] `packages/api/src/domain/loans/rate-resolver.spec.ts`, `rate-resolver.ts`.
- [x] `packages/api/src/domain/loans/amortization-schedule.spec.ts`, `amortization-schedule.ts` -- `amortizationSchedule(terms)` returning null when not amortizable; the matrix's ING, dates, zero-rate and variable rows.
- [x] `packages/api/src/domain/loans/insurance.spec.ts`, `insurance.ts` -- premiums and total.
- [x] `packages/api/src/routes/accounts.spec.ts` -- GET schedule: ING, null cases, non-loan, unknown account, viewer -- red first.
- [x] `packages/api/src/services/loans.ts`, `routes/accounts.ts` -- `loanSchedule(deps, accountId)` and the route.
- [x] `packages/app/src/lib/dates.ts` (+ spec), `hooks/useLoanSchedule.ts`, `lib/query-keys.ts`, `components/LoanSchedule.tsx`, the account route, `locales/fr.json` -- the tab.
- [x] `packages/app/e2e/accounts.spec.ts` -- ING mortgage: cards, sentence, rows 69, 70 and 300, past shading, no variable notice; a variable loan shows the notice and « Première mensualité »; a loan without amount has no tab; `packages/app/e2e/viewer.spec.ts` -- a viewer reads the tab.
- [x] `docs/sure-parity.md`, `EXPERIENCE.md` -- Loan row and account detail tabs.

**Acceptance Criteria:**
- Given an account whose terms change, when it is saved, then the « Échéancier » tab shows the new schedule (query invalidated with the account).
- Given the finished story, when `pnpm test` and `pnpm test:e2e` run, then each acceptance criterion of Story 24.2 has a test.

## Implementation Notes

## Spec Change Log

- Implementation found the matrix's « #7 » wrong: payments from 2026-01-01 put the 2026-07-01 payment at number 6, the one whose period straddles the 2026-06-20 change. The row was corrected to « #6, on 2026-07-01 » before any human approval; the test asserts the payment by its date. KEEP: the assertion by date.
- 2026-10-07, after Epic 24 merged, the owner: « Je ne vois vraiment pas l'intérêt de s'éloigner de Sure à ce stade ». An Archant document is no reason to depart from Sure; only integer money, French through i18next with Sure's own `fr.yml` wording, WCAG 2.2 AA contrast, security, Recharts and Archant's period selector are. A loan without an amount borrowed is amortised from its opening balance, Sure's `original_balance` falling back to the first valuation (`domain/loans/original-balance.ts`), so it has the tab; « never a fallback principal » is withdrawn. The cards are Sure's separate `summary_card`s in its `grid-cols-2 md:grid-cols-4`, not a summary strip. « Mensualité » becomes « Paiement mensuel », the wording of Sure's `fr.yml` for « Monthly Payment », « Première mensualité » « Paiement initial » and the column « Paiement ».


## Review Triage Log

| Finding | Verdict | Evidence | Route |
|---|---|---|---|
| Sprint status `in-progress` while the spec is `in-review` | false | the completion step sets both to `done` before the pull request | reject |
| « Coût total » shows principal plus interest, not the French « coût total du crédit » | false | Sure's `_schedule` card `total_cost` is `total_paid`, and the story's criteria name it | reject |
| Origination falls back to the opening date | false | Sure's `origination_date` falls back to the first valuation; the epic keeps it | reject |
| Hovering a past row lightens its shade | low | `TableRow` carries `hover:bg-muted/50`, which overrides `bg-muted`; direct correction | patch |
| Past rows told by colour alone | medium | WCAG 1.4.1; `data-past` is for tests only | patch |
| Schedule fetched on every loan page | low | Sure computes `amortizable?` and the chart's schedule on every loan page; 1 200 rows at most | reject |
| A failed schedule query hides the tab and its retry | medium | `scheduled` is false on error unless the URL asks for the tab (blind and edge layers) | patch |
| `Insurance`, `scheduled`, `balloonAmount` have no production caller | false | Story 24.2's first criterion requires them; knip counts the specs | reject |
| Past boundary (`date <= asOf`) untested on the day itself | low | only an end-to-end test with a pinned server clock reaches it (verification layer: defer) | defer |
| Route spec for a variable loan asserts only a larger payment | low | `simulator.spec.ts` and `amortization-schedule.spec.ts` assert the re-sized figures | reject |
| Parity row omits the origination date among the conditions | low | direct correction | patch |
| `rateResolver` assumes sorted changes while `simulate` sorts events | false | `parseLoanDetails` in `schemas/accounts.ts`, the only writer, sorts them; migration 0058 writes `[]` | reject |
| Tab list shifts when « Échéancier » appears after loading | low | « Positions » does the same; cosmetic | reject |
| Rate change before an opening date moved later accrues from origination | false | Sure's `accrual_rate_for` reads the same change; 24.1's triage rejected the same case | reject |
| `scheduled` strategy accepts a payment below the interest | false | no caller yet; Sure has no guard, and a balloon is what `converged` reports | reject |
| `adjustable` never asserted as `variable: true` | medium (gap) | only `fixed` and `variable` reach the route spec | patch |
| `?tab=schedule` on a non-loan account untested | medium (gap) | only loans open the tab in e2e | patch |
| QA: past rows not visibly shaded | medium | the screenshot showed `bg-muted` (#f7f7f7) on the page's #f8f8f8; switched to DESIGN.md's `inset` (#f2f2f3), Sure's `bg-container-inset`, and the e2e test now asserts that colour | patch |

## Design Notes

Assumptions decided by Sure, the owner being unavailable: the tab and its labels follow Sure's English `schedule` keys, since Sure's `fr.yml` has none; the table's dates are long, as Sure's `l(date, format: :long)`; past is `date <= today`, as Sure's `row_class`, today taken on the server in `APP_TIMEZONE` so the shading and Story 24.4's projection agree on one day; a variable notice translates Sure's `variable_rate_notice`. `null` rather than a new error code keeps the closed error union unchanged and mirrors Sure's tab test `amortizable?`.

ING check, run before writing this spec: the BigInt prototype reproduces every figure of the story's acceptance criteria exactly.

## Verification

**Commands:**
- `pnpm --filter @archant/api exec vitest run --project unit src/domain/loans src/routes/accounts.spec.ts` -- green, 100 % branches on `domain/loans/`.
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test && pnpm test:e2e` -- green, no tracked file changed after.

# Epic 24 Context: Loans as Sure follows them

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Catch up with Sure's loans, as read on Sure's `origin/main` at `14638a701` (2 October 2026): the terms Sure records, the amortisation schedule that re-amortises at each rate change, borrower insurance, the loan overview and the payoff projection charted beside the recorded balance and the contract. Sure built them in #2984, #3473, #3474 and #3327 (`app/models/loan/amortization_math.rb`, `simulator.rb`, `rate_resolver.rb`, `amortization_schedule.rb`, `insurance.rb`, `payoff_projection.rb`, `payoff_chart.rb`, and `loans/tabs/_overview`, `_schedule`, `_repayment_progress`). The reference case is the owner's ING mortgage: 130 000,00 € at 1,82 % over 300 months from 5 December 2020, a level payment of 539,69 € plus 31,60 € of level insurance at 0,2917 %. Story 7.1's end date and basis-point rate give way to Sure's term in months and finer rates. Sure's assistant and API expose none of it, so neither does Archant.

## Stories

- Story 24.1: Record a loan's terms as Sure does
- Story 24.2: The amortisation schedule
- Story 24.3: The loan overview
- Story 24.4: Where my loan is heading

## Requirements & Constraints

- Terms: amount borrowed, down payment (zero or more), origination date, term of 1 to 1 200 months (Sure's `MAX_PERIODS`), rate type `fixed`, `variable` or `adjustable` with dated rate changes, interest rate, insurance rate and insurance type `level_term`, `decreasing_life` or none. Every rate lies between 0 and 100 %. An origination date after today is refused with `invalid_date`. Without a start date, origination is the account's opening date.
- Existing loans migrate: rate × 100, and an end date stays until the details are next saved, when the dialog proposes the months to it as « Durée » and saving drops it.
- A loan without « Montant emprunté » has no schedule, no « Échéancier » tab and keeps the usual balance chart. The opening balance stays the amount still owed when the account was opened (Spec 7.1), never a fallback principal.
- The ING mortgage figures are acceptance tests: payment 69 leaves 105 104,82 €, payment 70 on 5 October 2026 repays 380,28 € of principal and 159,41 € of interest, total interest 31 906,96 €, insurance 9 480,00 €, last payment 539,65 € on 5 December 2045. An early repayment of 10 000,00 € ends the projection on 5 November 2043, 25 months early, saving 3 906,00 €.
- Three differences from ING's table stay as Sure has them: payments fall on the origination day, whole months are charged (no broken-period interest), and Sure numbers payments from origination. A first payment date and broken-period interest are deferred.
- Sure's `:hold` payment strategy has no caller and is not ported. French-market subtypes stay.
- Money is integer minor units, never a float. Every visible string goes through i18next in French. Keyboard-only use and WCAG 2.2 AA contrast.
- A viewer reads every loan figure; the server refuses their edits.
- Every acceptance criterion has an automated test: Playwright for what the interface shows, Vitest for the rest. `domain/loans/` is covered to the branch.

## Technical Decisions

- Terms live in `accounts.details` as `LoanDetails`, validated by Zod, with `rateChanges` as an array of `{ effectiveDate, rate }` inside it. No `loans` table (AD-6, Spec 7.1).
- Rates are integers in millionths: 1,82 % is `18200`, 0,2917 % is `2917` (AD-25, NFR1).
- `domain/loans/` holds Sure's `AmortizationMath`, `Simulator` (`reamortize` and `scheduled`), `RateResolver`, `AmortizationSchedule`, `Insurance` and `PayoffProjection` (`payoff-projection.ts`) as pure functions. Every loan figure reads them.
- Arithmetic is exact `BigInt` fractions. Each period's interest, payment and premium rounds half up to the minor unit, as Sure's `BigDecimal#round`. AD-22's half-to-even rounding does not apply. Overview shares are integer percentages.
- Payment n falls n months after origination, clamped to the month's end. A period accrues once, at the rate in force when it opened; a payment is sized at the rate in force on its date and re-sized only when that rate moves. The last payment settles the balance. At most 1 200 periods.
- Level insurance charges a twelfth of the rate on the amount borrowed; decreasing insurance a twelfth of the rate on the balance at the start of the period.
- Nothing is stored. Every figure is computed on read from the terms and the account's balance.
- Export (AD-23): the loan's `Account` line carries Sure's `accountable` fields (`initial_balance`, `down_payment`, `start_date`, `term_months`, `rate_type`, `interest_rate`, `variable_rate_schedule`, `insurance_rate`, `insurance_rate_type`), rates as Sure's decimal percentages.
- Roles (AD-21): saving terms uses a mutating method, so `viewerReadOnly` refuses it for a viewer; the interface hides edit controls unless `useIsAdmin()`.
- Rate-change errors use Sure's codes: `invalid_rate_change` for an incomplete row or a rate out of range, `rate_change_before_origination` for a date before origination. A row left empty is skipped, a date entered twice keeps the last.

## UX & Interaction Patterns

- The create dialog and « Modifier les détails du prêt » offer « Montant emprunté », « Apport personnel », « Date d'origine », « Durée (mois) », « Taux d'intérêt (%) » with three decimals, « Type de taux », « Taux d'assurance (%) » with four decimals and « Type d'assurance », with Sure's insurance hint. « Changements de taux » rows show for a variable or adjustable rate; switching to fixed hides them and keeps them.
- `LoanSummary` in the account header names the amount borrowed, the rate and its type, and the term in years or months.
- « Échéancier » tab: « Mensualité » (« Première mensualité » when it re-sizes later), « Intérêts totaux », « Coût total », a sentence naming the origination date, a notice for a variable rate, and a table of number, date, payment, principal, interest and balance with past rows shaded. Story 24.4 adds « Fin prévue » or « Non soldé à l'échéance ».
- « Vue d'ensemble » tab follows Sure's `_overview`: a figure it cannot compute reads « Inconnu », a payment past the schedule « N/D ». Leverage reads « 4,0x », banded « Prudent » below 4, « Modéré » from 4 to 8, « Élevé » from 8. A ring shows the share repaid, left out when it cannot be measured. The current instalment, the one after the months fully served, splits into capital, interest and insurance with shares and a total.
- The loan chart replaces the balance chart when a schedule exists: « Solde enregistré », « Échéancier du contrat », « Projection » and an « Aujourd'hui » marker, over the account chart's periods clamped to the loan's life, with a text summary and the « Voir les données » table alternative (UX-DR5). It names months and interest saved, or the amount left at maturity.
- Money renders through `<Money>`. `sure-parity.md`'s Loan row and `EXPERIENCE.md` change with the surface.

## Cross-Story Dependencies

- Order: 24.1, then 24.2. Stories 24.3 and 24.4 follow 24.2 in any order.
- 24.2's engine reads 24.1's terms. 24.3's overview and 24.4's projection and chart read 24.2's schedule; 24.3's « Modifier les détails du prêt » opens 24.1's dialog.
- Outside the epic: Spec 7.1's loan account and opening anchor, the account page's tabs and balance chart, AD-8's daily balances for « Solde enregistré », and Epic 18's export.

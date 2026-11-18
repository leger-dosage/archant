---
title: 'Story 28.4: Save a loan whose terms cannot be amortised'
type: 'feature'
created: '2026-10-14'
status: 'done'
baseline_commit: 'da503d4c378f8b4091b1fb9a458a2f10a52af212'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-28-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `parseLoanDetails` in `packages/api/src/schemas/accounts.ts` refuses a term outside 1 to 1 200 months, an interest or insurance rate above 100 % and an amount borrowed not above zero. Sure `00dd977fb` validates none of these on `Loan` (`app/models/loan.rb:29-48`): it saves the loan and only declines to amortise it (`Loan#amortizable?`, `:89-94`).

**Approach:** Two layers, as Sure. The server keeps only what Sure's model and columns refuse. The dialogs add what Sure's `loans/_form.html.erb` bounds in the browser: a term from 1 to `Loan::Simulator::MAX_PERIODS` (`:61-65`) and rates not below zero (`:26-30`, `:72-76`). The read side already follows `amortizable?` and stays.

**Decision (Sure over the epic's wording):** `epics.md` asks the dialog to save a term of 0 or above 1 200. Sure's form refuses both; only its server accepts them, for provider-written terms (`_form.html.erb:58`). The dialog follows Sure's form, and the e2e test reaches a term of 0 through the API.

## Boundaries & Constraints

**Always:**
- Server, as Sure's model and columns: term any whole number of months without a sign, up to 9 digits (`term_months` integer); interest rate unsigned, three decimals, seven digits before them (`decimal(10,3)`); insurance rate unsigned, four decimals, four digits before them (`decimal(8,4)`); amount borrowed any amount `parseAmount` reads, zero and negative included (Sure's money field, `min: -99999999999999`). Kept: start date not after today, down payment not below zero, rate type and insurance type enums, rate changes between 0 and 100 % (`MAX_INTEREST_RATE`) and not before origination.
- Dialogs, as Sure's form: the server's checks plus term 1 to `MAX_LOAN_TERM_MONTHS`, code `invalid_term`. Rates have no upper bound in the dialog either.
- A fixed loan with a rate and a term of 0 quotes a payment of 0, as Sure's `monthly_payment` (`term_months <= 0`); above 1 200 months it reads « Inconnu ».
- The term card shows the saved term (« 0 mois », « 125 ans »), as Sure's.
- No schedule, no « Échéancier » and the plain balance chart whenever `amortizationSchedule` returns `null`; it already ports `amortizable?`.

**Never:** no change to `get_accounts` (Sure's carries no loan field); no requirement on the amount borrowed in the dialog (Archant's fallback to the opening balance stays); no migration; no negative interest rate on the server (Sure's form never sends one, and the amortisation maths divide by zero at −1 200 %).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Term 0 via API | `termMonths: "0"`, fixed, 3 % | saved; no « Échéancier »; payment 0; « 0 mois » | none |
| Term 1 500 via API | `termMonths: "1500"` | saved; no schedule; payment « Inconnu »; « 125 ans » | none |
| Term 0 in dialog | « Durée » 0 or 1 201 | not sent | `invalid_term` under the field |
| Rate 150 % | dialog or API | saved; schedule built | none |
| Insurance 120 % | dialog or API | saved | none |
| Amount borrowed 0 or −5 000 | dialog or API | saved; no schedule | none |
| Negative interest rate | `-1` | refused | `invalid_rate` |
| Rate change 101 % | variable loan | refused | `invalid_rate_change` |
| Export | term 0 | `term_months: 0` in `accountable` | none |

</frozen-after-approval>

## Code Map

- `packages/api/src/schemas/accounts.ts:80-135` -- `parsePercent`, `MAX_RATE`, `parseRate`, `TERM_PATTERN`; `:150-255` `parseLoanDetails` (bounds at `:172`, `:197-206`, `:212-226`); `:414-475` `reportLoanDetailsIssues`, `createAccountSchema`; `~:538-560` `accountSettingsFormSchema`. The rate-change check keeps the 100 % cap.
- `packages/data/account-types.ts:136` -- `MAX_LOAN_TERM_MONTHS`, now the dialog's bound and the schedule's.
- `packages/app/src/components/CreateAccountDialog.tsx:65` -- resolver on `createAccountSchema`, which the route shares; `EditAccountDialog.tsx:164-176` on `accountSettingsFormSchema`.
- `packages/api/src/domain/loans/overview.ts:238-257` -- `monthlyPaymentOf`: add `termMonths <= 0` to the zero branch.
- Already correct, tests only: `domain/loans/amortization-schedule.ts:57-86`, `services/loans.ts` (`null` routes), `routes/_authed.accounts.$accountId.tsx:488-513`, `LoanOverview.tsx`, `services/export.ts:175-192`.
- `packages/api/src/testing/sure-preflight.ts:268` -- `term_months: z.int().min(1).max(1200)` refuses an export Sure accepts.
- `packages/app/src/locales/fr.json:2416` -- `invalid_rate` names « entre 0 et 100 ».
- `docs/sure-parity.md:63` -- Loan row: « (1 to 1 200) » and the « Later. Story 28.4 » clause.
- `docs/architecture.md:233-237` -- AD-25 says a schedule has at most 1 200 periods; still true, no edit.

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/routes/accounts.spec.ts` -- `:388-407`: accept `"0"`, `"1201"`, `"999999999"`; refuse `"12,5"`, `"-3"`, `"abc"`, `"1000000000"`; accept rate `"150"` and insurance `"120"`, amounts `"0"` and `"-5000"`; refuse rate `"-1"`; `:1680` stops relying on `invalid_term`. Each case reads the loan back: schedule `null`, overview as the matrix -- test-first.
- [x] `packages/api/src/domain/loans/overview.spec.ts` -- fixed loan, term 0: payment `0n` -- test-first.
- [x] `packages/api/src/schemas/accounts.ts` -- server bounds as Always; `createAccountFormSchema` and the loan part of `accountSettingsFormSchema` add the dialog's term bound; the route keeps `createAccountSchema`.
- [x] `packages/app/src/components/CreateAccountDialog.tsx` -- resolver on `createAccountFormSchema`.
- [x] `packages/api/src/domain/loans/overview.ts` -- the zero branch.
- [x] `packages/api/src/testing/sure-preflight.ts` -- `term_months` as Sure's integer, nullable.
- [x] `packages/app/src/locales/fr.json` -- `invalid_rate`: « Taux invalide : un nombre positif, trois décimales au plus, quatre pour l'assurance. »
- [x] `packages/app/e2e/accounts.spec.ts` -- `:421` keeps « Durée invalide » for 0 in the dialog and saves a rate of 150 %; a new test creates a loan with `termMonths: "0"` through the API, finds no « Échéancier », a payment of 0 € and « 0 mois » in « Aperçu ».
- [x] `docs/sure-parity.md` -- Loan row: server and dialog bounds as Sure's, the clause to Parity.

**Acceptance Criteria:**
- Given a fixed-rate loan saved through the API with a rate and a term of 0, when its page opens, then it shows « Opérations » and « Aperçu » only, the balance chart, and « Paiement mensuel » 0 €.
- Given the creation or edit dialog, when « Durée » is 0 or 1 201, then the dialog refuses it as Sure's form does, and a rate of 150 % saves.
- Given the finished story, when `pnpm test` and `pnpm test:e2e` run, then Vitest covers each failing condition of `amortizable?` on save and on read.

## Implementation Notes

- The amount-borrowed rows of the matrix (0, −5 000) open the loan with an opening balance of 0: Sure's `original_balance` falls back to the first valuation when the recorded amount is not positive, so with Archant's usual opening balance the loan still amortises that balance, as Sure's.
- `parseRate` split into `parseInterestRate` (seven digits, three decimals), `parseInsuranceRate` (four and four) and a private `parseRateChangeRate` that keeps the 100 % cap.
- `createAccountFormSchema` and `accountSettingsFormSchema` add `invalid_term` outside 1 to `MAX_LOAN_TERM_MONTHS` in `reportLoanDetailsIssues`; `packages/api/src/schemas/accounts.spec.ts` covers both dialogs against the API's schema.
- The preflight reads `term_months` as `z.int32()`, Sure's signed integer column.

## Spec Change Log

## Review Triage Log

| Layer | Finding | Verdict | Evidence / route |
|-------|---------|---------|------------------|
| verification-gap | No e2e proves the creation dialog bounds the term | medium | Reverting `CreateAccountDialog.tsx:65` to `createAccountSchema` fails nothing. Patched: the loan-creation e2e types 0 first. |
| blind | PATCH saving a term of 0 is untested | low | `updateAccountSchema` runs `parseLoanDetails` without the dialog bound; only refusals were tested. Patched. |
| blind | The fallback to the opening balance when the amount borrowed is 0 is untested | low | Sure's `original_balance:463-468`; the rows force an opening balance of 0. Patched. |
| blind | Parity row's « Paiement mensuel » card omits the term of 0 | low | Patched. |
| blind | `epics.md` still asks the dialog to save a term of 0 | low | The spec's decision follows Sure's form. Patched. |
| blind, edge, gap | The edit dialog refuses any change to a loan whose saved term is 0 or above 1 200 | false | Sure's `loans/_form` carries `min: 1, max: 1200` on the same pre-filled field, so its form blocks the same submit. |
| blind, edge | A rate near 9 999 999 % on a multi-million loan overflows `toMinorUnits` | low | Real only past about 10 M€ at 10⁷ %: no household meets it, and the fix adds a guard. Rejected. |
| blind, edge | « un nombre positif » is ambiguous at 0 and names no digit limit | low | In French « positif » includes zero; the digit limits are Sure's column widths, out of a typed rate's reach. Rejected. |
| blind, edge | A variable loan with a term of 0 reads « N/D », untested | false | Sure's overview shows `not_applicable` when `payment_in_force` is nil, which a variable loan without a schedule always is. |
| edge | `:1680` still relies on `invalid_term` | false | It now sends `"abc"`, still invalid; the test's subject is the future start date. |
| blind | Sprint status and spec status disagree | false | The completion step sets both to `done`. |
| blind | The frozen AC lists « Opérations » and « Aperçu » only, the e2e adds « Soldes » and « Imports » | low | Every account has those two tabs; the AC's point is no « Échéancier ». Frozen text; rejected. |
| blind | `TERM_PATTERN` counts characters, refusing ten-character zero-padded terms | low | Nobody types ten leading zeros; rejected. |
| blind | The `dialog` flag reindents `createAccountSchema` | low | A refinement after the transform would not run when another field fails, losing the « every error at once » behaviour the schema documents. Rejected. |
| blind | No e2e for 1 201, insurance 120 % or « 125 ans » in the browser | low | `schemas/accounts.spec.ts`, the route spec and `loan-details.spec.ts` cover each; the browser adds nothing. Rejected. |

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test && pnpm test:e2e` -- expected: all green, no tracked file changed after.

**Manual checks:**
- Screenshots of a term-0 loan's page (header, chart, « Aperçu ») and the dialog's « Durée invalide », light and dark, beside Sure's.

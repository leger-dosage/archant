---
title: "Story 24.1: Record a loan's terms as Sure does"
type: 'feature'
created: '2026-10-07'
status: 'done'
route: 'dispatch'
baseline_commit: '3f85ce7d45aea6e8653b99607670ef57068f94ff'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-24-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A loan holds only an amount borrowed, a rate in basis points and an end date (Spec 7.1), so Archant cannot compute what an instalment repays: Sure's schedule needs an origination date, a term in months, a rate type with its dated changes, a down payment and borrower insurance, with rates finer than two decimals (0,2917 %).

**Approach:** Widen `LoanDetails` in `accounts.details` to Sure's loan columns (read at `14638a701`), rates in millionths (AD-25); migrate existing loans; edit the terms in the create dialog and the account edit dialog; show them in `LoanSummary`; export them in Sure's `accountable`. Story 24.1 of `epics.md` is the acceptance contract; this spec adds what reading the code settled.

## Boundaries & Constraints

**Always:**
- `LoanDetails` = `originalAmount`, `downPayment` (MinorUnits ≥ 0), `startDate` (ISO), `termMonths` (1–1 200), `rateType` (`fixed` | `variable` | `adjustable`), `interestRate`, `insuranceRate` (integers in millionths, 0 to 1 000 000), `insuranceRateType` (`level_term` | `decreasing_life`), `rateChanges: { effectiveDate, rate }[]` sorted by date, and `endDate`, kept only for loans not saved since the migration. Every scalar is nullable, a blank input meaning « not known », as today.
- Typed rates: « Taux d'intérêt » and each change up to three decimals, « Taux d'assurance » up to four, comma or point, optional `%`, parsed from digits (never a float) by one `parseRate(text, decimals)` in `schemas/accounts.ts`; above 100 % or too many decimals is `invalid_rate`.
- Field codes, under `details.<field>`: `invalid_amount` (amount borrowed ≤ 0, down payment < 0), `invalid_rate`, `invalid_term` (new: not a whole number 1–1 200), `invalid_date` (not a date, or after today in `APP_TIMEZONE`, checked by the service with `today(deps.timeZone)` since the shared schema has no time zone), `invalid_rate_change`, `rate_change_before_origination` (both under `details.rateChanges`, Sure's codes). Each gets a French message in `fr.json` `fields`.
- `rateChanges` rows: both fields blank is skipped; one blank, a bad date or a bad rate is `invalid_rate_change`; a date before origination (`startDate`, else the account's opening date) is `rate_change_before_origination`, checked only for a variable or adjustable rate, as Sure's; a repeated date keeps the last row. Rows are stored whatever the rate type: switching to fixed hides them in the form and keeps them, as Sure's `rate_changes=`.
- A PATCH still replaces `details` whole; every save writes `endDate: null`.
- Migration `0058`, hand-written: for each `type = 'loan'`, `interestRate × 100` when not null, and every new key added (`null`, `rateChanges` `[]`); `endDate` untouched.
- The edit form proposes « Durée (mois) » for a loan with an `endDate` and no `termMonths`: whole calendar months from origination to the end date, ignoring days, clamped to 1–1 200.
- The dialog is the existing « Modifier le compte » (`EditAccountDialog`): Sure's « Modifier les détails du prêt » (`edit_loan_path`) opens its account edit form. Story 24.3 adds that button.
- Field order and labels as the story's acceptance criteria; « Type de taux » defaults to « Fixe » when a rate is typed, else blank; « Type d'assurance » « Aucune » stores null.
- `LoanSummary`: « Emprunté : 130 000,00 € », « Taux : 1,820 % fixe » (three decimals, type in lower case, no type when unknown), « Durée : 25 ans » when divisible by 12, else « 30 mois ». It no longer shows an end date.
- Export: `accountable` gains Sure's keys with Sure's formats: amounts as decimals, `start_date` ISO, `term_months` integer, rates as decimal percentage strings (`18200` → `"1.82"`, `2917` → `"0.2917"`, trailing zeros trimmed), `variable_rate_schedule` as `{ "YYYY-MM-DD": "rate" }` (`{}` when none). `archant.loan_end_date` stays.

**Never:** no schedule, overview, projection or tab (24.2 to 24.4); no new dialog or route; no MCP tool change (Sure's assistant exposes none); no Sure import; no `subtype` change (French-market subtypes stay); no rate stored as a float or a string.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected |
|---|---|---|
| ING mortgage | 130 000, start 2020-12-05, 300, fixed 1,82, insurance 0,2917 level | stored `18200`, `2917`, `level_term` |
| Too precise | interest « 1,8205 » | `invalid_rate` |
| Future start | tomorrow | `invalid_date` |
| Term | « 0 », « 1201 », « 12,5 » | `invalid_term` |
| Changes | blank row, full row, row with date only | `invalid_rate_change` |
| Before origination | variable, change 2020-01-01, start 2020-12-05 | `rate_change_before_origination` |
| No start date | variable, change before the opening date | `rate_change_before_origination` |
| Twice | two rows 2025-01-01 at 2 % then 3 % | one row, 3 % |
| To fixed | variable with changes, saved as fixed | rows kept, hidden |
| Migration | `interestRate: 345`, `endDate: "2045-12-05"` | `34500`, end date kept, new keys null |
| Legacy edit | that loan opened 2020-12-05 | « Durée » proposes 300; saving clears `endDate` |
| Viewer | PATCH details | 403, nothing written |

</frozen-after-approval>

## Code Map

- `packages/data/account-types.ts:96` -- `LoanDetails`; add `LOAN_RATE_TYPES`, `LOAN_INSURANCE_TYPES`, `MAX_LOAN_TERM_MONTHS` here for app and API.
- `packages/data/schema/accounts.ts:19` -- `details` JSON typed `LoanDetails`; no column change, so `drizzle-kit generate` sees nothing.
- `packages/data/drizzle/0057_add_recurring_occurrences.sql`, `meta/_journal.json` -- last migration; `0012_add_category_origin.sql:22` uses `json_insert`, `0055` documents a hand edit.
- `packages/data/migrate.spec.ts` -- `migratedBefore`, `insertAccount`, loan fixtures at :908, :955.
- `packages/api/src/schemas/accounts.ts:28-125,209-240` -- `loanDetailsInputSchema`, `parseRate` (basis points today), `parseLoanDetails`, `reportLoanDetailsIssues`, create/update/form schemas shared with the app.
- `packages/api/src/services/accounts.ts:190-214` -- `updateAccount` parses details; add the today and origination checks there; `services/ledger/accounts.ts:35,55` for creation.
- `packages/api/src/routes/accounts.spec.ts:139-245,1113-1182` -- loan POST and PATCH tests to rewrite to millionths.
- `packages/api/src/services/export.ts:154,775-790` -- `percent(basisPoints)` and the `Account` line's `accountable`; `export.spec.ts:186,745`.
- `packages/api/src/testing/sure-preflight.ts:256` -- strict `accountable`; widen to the new keys.
- `packages/app/src/components/LoanDetailsFields.tsx` -- shared fields; grows to the full form plus the rate-change rows (`useFieldArray`).
- `packages/app/src/components/CreateAccountDialog.tsx:52-112,263`, `EditAccountDialog.tsx:45-119,200` -- wiring, defaults, `loanDetailsToInput`.
- `packages/app/src/lib/loan-details.ts` (+ spec) -- `rateToText`, `formatRate`, `loanDetailsToInput`; move to millionths, add the proposed term.
- `packages/app/src/components/LoanSummary.tsx`, `routes/_authed.accounts.$accountId.tsx:523` -- header summary.
- `packages/app/src/locales/fr.json:189-199,2238+` -- `loanDetails` labels, field codes.
- `packages/app/e2e/accounts.spec.ts:249-300`, `viewer.spec.ts:57`, `fixtures.ts:32,187` -- Story 7.1 tests and `api.openAccount({ details })`.
- `docs/deployment.md:207,211` -- export paragraph naming a loan's end date and Sure ignoring its rate.

## Tasks & Acceptance

**Execution:**
- [x] `packages/data/migrate.spec.ts` -- test 0058 on a loan with a rate, one without, and a non-loan -- red first.
- [x] `packages/data/drizzle/0058_loan_terms.sql`, `meta/_journal.json` -- the hand-written `json_set` migration, `-- Edited by hand:` header.
- [x] `packages/data/account-types.ts` -- widened `LoanDetails` and constants, comment updated to millionths.
- [x] `packages/api/src/routes/accounts.spec.ts` -- rewrite the loan tests and cover the matrix (viewer included) -- red first.
- [x] `packages/api/src/schemas/accounts.ts` -- new input schema, `parseRate(text, decimals)`, term, down payment, rate-change parsing.
- [x] `packages/api/src/services/accounts.ts`, `services/ledger/accounts.ts` -- future start date and before-origination checks with the account's opening date.
- [x] `packages/api/src/services/export.spec.ts`, `export.ts`, `testing/sure-preflight.ts` -- Sure's `accountable` keys and formats.
- [x] `packages/app/src/lib/loan-details.spec.ts`, `loan-details.ts` -- millionths formatting, proposed term, term wording.
- [x] `packages/app/src/components/LoanDetailsFields.tsx`, `CreateAccountDialog.tsx`, `EditAccountDialog.tsx`, `LoanSummary.tsx`, `locales/fr.json` -- the form, its rows and the summary.
- [x] `packages/app/e2e/accounts.spec.ts` -- create the ING mortgage through the form and read the header; add then hide rate changes; a refused change. The legacy loan's proposed term is a unit test of `loanDetailsToInput`, since the API no longer accepts an `endDate` to seed one.
- [x] `docs/deployment.md`, `docs/sure-parity.md` -- loan terms in the export, Loan row.

**Acceptance Criteria:**
- Given a viewer on a loan, when the page opens, then `LoanSummary` shows its terms and no edit control.
- Given the finished story, when `pnpm test` and `pnpm test:e2e` run, then each acceptance criterion of Story 24.1 has a test.

## Implementation Notes

- The future start date is checked in `createAccount` and `updateAccount` of `services/accounts.ts`; `services/ledger/accounts.ts` is untouched, since a bank-linked loan is created with null details.
- A whole rate exports as `"3.0"`, as Rails writes a `BigDecimal`, not `"3"`: Sure's own export reads the same.
- `LoanSummary` still shows « Fin : … » for a migrated loan with an end date and no term, against the frozen « It no longer shows an end date »: otherwise every existing loan loses its only visible maturity until it is saved (review triage). The owner confirms or reverts this.
- With a fixed or blank rate type, an invalid rate-change row is dropped silently, as Sure's disabled hidden section submits nothing; only a variable or adjustable loan is refused `invalid_rate_change`.
- `LoanDetailsFields` takes the details as one controlled value rather than `useFieldArray`: the two forms have different types, and a typed field array needed casts.
- The proposed term is unit-tested through `loanDetailsToInput`: the API no longer accepts `endDate`, so Playwright cannot seed a migrated loan.

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Evidence | Route |
|---|---|---|---|
| Hidden incomplete rate-change row blocks a fixed loan's save | medium | `parseRateChanges` raises `invalid_rate_change` whatever the rate type; Sure disables the hidden section, so nothing typed there is submitted | patch |
| No button removes a rate-change row | low | Sure's `_rate_change_row` has « Remove »; emptying a row works but leaves it on screen; needs stable row keys | defer |
| Rate-change error describes no row | low | rows set `aria-invalid` without `aria-describedby`; direct correction | patch |
| Insurance rate accepted with « Aucune » | false | Sure validates the two independently; 24.3 shows a rate with no type as « 0,2917 % par an » | reject |
| « Fixe » default only in the interface, migration leaves `rateType` null | false | Sure stores a blank `rate_type` as unknown; a migrated loan needs editing anyway for its term | reject |
| Rate type cannot return to blank | low | Sure's select has no blank either; rare | reject |
| Down payment above the amount borrowed | false | Sure checks only `>= 0` | reject |
| Start date unrelated to the opening date | false | Sure has no such check; the opening balance is what was owed then (Spec 7.1) | reject |
| `rateChanges` unbounded | low | no `.max`; direct correction | patch |
| Migrated loans lose « Fin : … » in the header | medium | `LoanSummary` dropped `endDate` while `termMonths` stays null until a save | patch |
| `proposedTerm` clamps an end date before origination to 1 | low | the frozen intent clamps to 1–1 200; such a legacy loan is unlikely | reject |
| `invalid_date` message names two causes | low | the story fixes the code `invalid_date`; cosmetic | reject |
| Task names `services/ledger/accounts.ts`, untouched | false | the check runs in `createAccount` of `services/accounts.ts`; bank-linked loans are created with null details, so nothing bypasses it | reject |
| `EXPERIENCE.md` not updated | false | it describes no loan field or loan header | reject |
| `sure-preflight.ts` copies constants | low | direct correction: import them | patch |
| Migration test misses a loan with null details | low | the `WHERE` already skips it; test is a direct addition | patch |
| `formatRate` mis-rounds 9995 | false | interest rates have three decimals, so millionths are multiples of 10 and never round | reject |
| Proposed term from a later opening date | false | the frozen intent takes the opening date when no start date is known; the dialog shows the value before saving | reject |
| Rate changes left before origination after an opening-date move | maybe-false | Sure re-checks only on save, as Archant does; would need an opening-date edit path that skips details | reject (low if true) |
| E2E never reads back down payment, start date, insurance | medium (gap) | the ING test asserts only the header, which shows none of them | patch |
| Proposed term only unit-tested, not through the dialog | medium (gap) | no way to seed `endDate` through the API in e2e | defer |

## Design Notes

Millionths of one, not of a percent: 1,82 % = 0,0182 = `18200`. Three typed decimals of a percent is five of the fraction, four is six, so both are exact. `parseRate("1,82", 3)` → `18200`; `parseRate("0,2917", 4)` → `2917`.

Sure validates neither `term_months` nor the rate against `MAX_PERIODS` and `MAX_INTEREST_RATE` on save, it only refuses to amortise; the story makes both a validation, so a saved loan always has a computable schedule in 24.2.

The term wording departs from Sure's `pluralize(term_months / 12, "year")`, which shows 30 months as « 2 years »: Archant names months when the years are not whole, so the summary never hides months.

## Verification

**Commands:**
- `pnpm --filter @archant/data test` -- migration spec green.
- `pnpm --filter @archant/api exec vitest run --project unit src/routes/accounts.spec.ts src/services/export.spec.ts` -- green.
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test && pnpm test:e2e` -- green, no tracked file changed after.

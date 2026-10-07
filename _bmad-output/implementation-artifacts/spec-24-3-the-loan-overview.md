---
title: 'Story 24.3: The loan overview'
type: 'feature'
created: '2026-10-07'
status: 'done'
route: 'dispatch'
baseline_commit: '4b82f7235435e1e37dcaa715cc783d7af9f4459c'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-24-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 24.2 shows a loan's schedule, but nothing tells the owner at a glance what he borrowed, what he owes, what the loan costs with its insurance, how much he has repaid and what his next instalment pays.

**Approach:** Port the figures of Sure's `Loan` model, read at `14638a701` (`months_elapsed`, `payment_breakdown`, `balance_paid_ratio`, `initial_leverage_ratio`, `leverage_band`, `total_cost`, `current_variable_rate`, `payment_in_force`), to pure functions in `packages/api/src/domain/loans/overview.ts`, computed on read behind `GET /api/accounts/:id/overview`, and show them in a « Vue d'ensemble » tab as Sure's `loans/tabs/_overview` and `_repayment_progress`. Story 24.3 of `epics.md` is the acceptance contract; this spec adds what reading Sure settled.

## Boundaries & Constraints

**Always:**
- Today is `today(deps.timeZone)`, one `asOf` for every figure. Origination is `startDate`, else the opening date, as Story 24.2. Schedule and premiums come from `amortizationSchedule` and `insurance`, never re-derived.
- `originalAmount`: the details' amount, else null; `remainingBalance`: the account's balance. `interestRate`: null without `interestRate`, else `rateResolver` (a null rate type read as fixed) at `asOf`. `monthlyPayment`: a variable or adjustable loan's first payment dated on or after `asOf`, else `"not_applicable"`; a fixed loan's `periodicPayment`; null otherwise (no rate type, or a fixed loan without schedule). `termMonths`, `rateType` as recorded. `payoffDate`: the schedule's last payment date, else null.
- `insured` when a schedule exists and `insuranceRate > 0`, as Sure's `Insurance.for`. `totalCost`: `totalPaid` plus the premiums' total, null without schedule. `insurance`: `{ total }` when insured, else `{ rate }` when `insuranceRate > 0`, else null.
- `leverage` when `downPayment > 0` and `originalAmount > 0`: `tenths` = amount × 10 / down payment rounded half up; band `conservative` when amount ≤ 4 × down payment, `moderate` when ≤ 8 ×, else `high`, in integers, as Ruby's inclusive `LEVERAGE_BANDS` and `find`.
- `repaidPercent` when `originalAmount > 0`: 100 × (amount − |balance|) / amount rounded half up, clamped to 0–100, as Sure's `balance_paid_ratio`.
- `instalment`: months elapsed = calendar months from origination to `asOf`, minus one when `addMonths(origination, months) > asOf`, clamped to [0, term], 0 before origination. None without schedule or when elapsed ≥ term or ≥ the payments' count; otherwise payment elapsed + 1 with its principal, interest, premium (0 without insurance), total, and each part's share of the total as an integer percent rounded half up, zeros for a zero total.
- `{ data: null }` for an account that is not a loan; `NOT_FOUND` for an unknown one; a loan without details answers every figure null. A viewer reads it.
- Tab `overview`, « Vue d'ensemble », on every loan, after « Soldes » and before « Échéancier », Sure's order; a link to it on another account opens « Opérations ». Read only while the tab is open; key `queryKeys.accounts.overview(id)`, under `detail(id)`.
- Cards via `SummaryStrip`: « Capital d'origine », « Capital restant », « Taux d'intérêt » (`formatRate`), « Mensualité » (« N/D » for `"not_applicable"`), « Durée » (`truncatedTermOf`: months under a year, else whole years, as Sure), « Date de fin d'origine » (`longDate`, Sure's « Original Payoff Date »), « Type » (« Fixe », « Variable », « Révisable »), « Coût total assurance comprise » when `insured` else « Coût total », « Assurance » (the total, or « 0,292 % par an » through `formatInsuranceRate`, Sure's three decimals stripped), « Effet de levier » (« 4,0x » and « Prudent », « Modéré » or « Élevé », coloured as Sure's `loan_leverage_band_class`: the income green, warning, destructive). A null figure reads « Inconnu ».
- Ring: `ProgressRing` in `--warning`, Sure's colour, 160 px with the percentage and « sur 130 000,00 € » inside, named « 19 % remboursé sur 130 000,00 € », under « Remboursé ». Instalment card: « Échéance 70 · 5 octobre 2026 », a list of « Capital », « Intérêts », « Assurance » (left out at zero), each with amount and share, and « Total ».
- « Modifier les détails du prêt », a ghost button for an administrator only, opens `EditAccountDialog`.

**Never:** no stored figure, migration or new error code; no projection, « Fin prévue » or chart (Story 24.4); no MCP tool or export change; no fallback principal.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected |
|---|---|---|
| ING | 24.2's ING terms, balance 10 510 482, asOf 2026-10-04 | repaid 19; instalment #70 2026-10-05: 38 028 + 15 941 + 3 160 = 57 129, shares 67 / 28 / 6; payoff 2045-12-05; totalCost 17 138 696, insured; insurance total 948 000; payment 53 969; rate 18 200 |
| Instalment day | asOf 2026-10-05 | #71 |
| Before origination | asOf before start | #1 |
| Finished | asOf after last payment | no instalment |
| Variable | change to 3 % on 2023-06-05 | rate 30 000; payment = first payment on or after asOf; none after the last → `"not_applicable"` |
| Rate only | insuranceRate, no amount | `insurance: { rate }`, totalCost null, not insured |
| Leverage | 400 000 / 100 000; 400 001; 800 000; 800 001 | 40 conservative; 40 moderate; 80 moderate; 80 high |
| Overpaid | balance above amount; −32 500,00; −140 000,00 | repaid 0; 75; 0 |
| No details | loan, details null | every figure null, no ring, no instalment |

</frozen-after-approval>

## Code Map

- `packages/api/src/domain/loans/amortization-schedule.ts`, `insurance.ts`, `rate-resolver.ts`, `amortization-math.ts:20` (`roundHalfUp`) -- reuse; do not change their behaviour.
- `packages/api/src/domain/dates.ts` -- `addMonths`, `today`.
- `packages/api/src/services/loans.ts` -- `loanSchedule`: shape to copy for `loanOverview(deps, accountId)`; `getAccount` gives `balance`, `openingDate`, `details`.
- `packages/api/src/routes/accounts.ts:80` -- add `.get("/:id/overview")` beside `/:id/schedule`.
- `packages/api/src/routes/accounts.spec.ts:2126-2260,1642` -- schedule spec, `ingTerms`, `mortgage`, viewer test; `vi.setSystemTime` is faked by `useSignedInApp`.
- `packages/app/src/hooks/useLoanSchedule.ts`, `lib/query-keys.ts` -- add `useLoanOverview` and `queryKeys.accounts.overview(id)`.
- `packages/app/src/routes/_authed.accounts.$accountId.tsx` -- `ACCOUNT_TABS`, tab gating, triggers and panels; holds the dialog state for the overview's edit button.
- `packages/app/src/components/LoanSchedule.tsx`, `SummaryStrip.tsx`, `Money.tsx`, `ProgressRing.tsx` (label is goals-only today: add a `label` prop), `EditAccountDialog.tsx`, `lib/loan-details.ts` (`formatRate`, `termOf`, `rateToText`), `lib/dates.ts` (`longDate`).
- `packages/app/src/locales/fr.json` -- new `loanOverview` keys; `accountDetail.tabs.overview`.
- `packages/app/e2e/accounts.spec.ts:417-560`, `viewer.spec.ts:228` -- ING test, tab lists to update, viewer read.
- `docs/sure-parity.md:61`, `_bmad-output/planning-artifacts/ux-designs/ux-archant-2026-09-21/EXPERIENCE.md` (Account detail row).

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/domain/loans/overview.spec.ts`, `overview.ts` -- `monthsElapsed`, `leverage`, `repaidPercent`, `paymentBreakdown`, `loanOverview` -- the matrix, red first, 100 % branches.
- [x] `packages/api/src/routes/accounts.spec.ts` -- GET overview: ING on 2026-10-04, variable, non-loan null, unknown account, viewer -- red first.
- [x] `packages/api/src/services/loans.ts`, `routes/accounts.ts` -- `loanOverview` and the route.
- [x] `packages/app/src/hooks/useLoanOverview.ts`, `lib/query-keys.ts`, `components/ProgressRing.tsx` (+ `GoalCard`, goal page callers), `components/LoanOverview.tsx`, the account route, `locales/fr.json` -- the tab.
- [x] `packages/app/e2e/accounts.spec.ts` -- ING overview: every card, ring, instalment number and date computed from today in `Europe/Paris`, « Assurance 31,60 € 6 % », « Total 571,29 € »; edit button opens « Modifier le compte »; a loan without amount reads « Inconnu »; tab lists updated; `viewer.spec.ts` -- a viewer reads the tab without the edit button.
- [x] `docs/sure-parity.md`, `EXPERIENCE.md` -- Loan row and account detail tabs.

**Acceptance Criteria:**
- Given a loan whose terms or balance change, when the overview is open, then it shows the new figures (query under `detail(id)`).
- Given the finished story, when `pnpm test` and `pnpm test:e2e` run, then each acceptance criterion of Story 24.3 has a test.

## Implementation Notes

## Spec Change Log

- 2026-10-07, after merge, the owner: « Je ne vois pas de raison de s'éloigner de Sure sur cette suite de tâches ». Every departure that only an Archant document justified is aligned on Sure: a negative balance counts by its size (`abs`), not as fully repaid (AD-5 dropped here); the leverage band is coloured as `loan_leverage_band_class`, the income green standing for Sure's success, which no token carries at 4.5:1; « Durée » truncates to years; the ring takes `--warning` and Sure's size, the percentage and « sur … » inside; the insurance rate alone prints with Sure's three decimals, « 0,292 % par an »; « Date de fin prévue » becomes « Date de fin d'origine », Sure's « Original Payoff Date », which Story 24.4's « Fin prévue » no longer echoes; the instalment's total is medium weight and the edit button has Sure's `py-8`. Kept, forced or outside this story: French labels and rate types through i18next; the summary strip of DESIGN.md in place of Sure's separate cards, as every Archant summary; no fallback principal (Spec 7.1).

## Review Triage Log

| Finding | Verdict | Evidence | Route |
|---|---|---|---|
| The spec is missing from the review diff | false | excluded on purpose: the spec goes to the edge-case layer alone | reject |
| `last_updated` moves back from 16:00 to 13:40 | false | the old value was ahead of the clock; 13:40 is the real time of the change | reject |
| An adjustable loan quotes a payment where Sure reads « Unknown » | false | Sure's `variable_rate_type?` is any non-blank type but `fixed`, so `adjustable` takes `payment_in_force` | reject |
| A negative balance reads 75 % repaid, not the matrix's 100 % | medium | `repaidPercent` used `abs`, Sure's; AD-5 stores what a liability owes, so a negative balance owes nothing; the frozen matrix says 100 | patch |
| Parity row omits the term, tab order, ring tint and sign departures | low | direct correction | patch |
| On a due date « Mensualité » names payment N while the card shows N+1 | low | Sure's `payment_in_force` (`date >= as_of`) and `months_elapsed` behave the same; the story follows Sure | reject |
| A second `EditAccountDialog` beside `AccountMenu`'s | low | only one opens at a time and each resets to the saved account; no harm named | reject |
| `LoanOverview` names a domain type, a service, a hook type and a component | low | same pattern as `amortizationSchedule` / `loanSchedule` / `LoanSchedule` in 24.2 | reject |
| Percent spacing mixes U+202F and a plain space | low | `formatRate` already prints a plain space in the header; cosmetic | reject |
| No e2e for a variable overview, « N/D » or the other bands | low | domain and route specs assert them; the e2e shows the cards, « Inconnu », « 4,0x » and « Prudent » at the inclusive boundary | reject |
| Panel empty if the answer turns null while open | false | an account's type never changes after creation (`EditAccountDialog`) | reject |
| Route test « every figure null » omits three fields | low | `toMatchObject` skips `termMonths`, `rateType`, `insured`; direct correction | patch |
| `EXPERIENCE.md` and the parity row describe different detail | false | EXPERIENCE.md summarises the surface; the parity row carries the figure detail, as for 24.2 | reject |
| Shares can add up to 101 % | false | the story's criteria require 67 %, 28 % and 6 %, Sure's per-part rounding | reject |
| e2e derives today from the test's clock, not the server's | low | both read `Europe/Paris`; they differ only across midnight during one test | reject |
| Decreasing insurance's instalment premium untested (verification layer) | medium (gap) | every overview test uses `level_term`, whose premium never changes | patch |

## Design Notes

Assumptions decided by Sure, the owner being unavailable. Leverage bands follow Sure's code, where `0..4` is inclusive and found first: exactly 4,0x reads « Prudent » and 8,0x « Modéré », although the epic's wording says « from 4 » and « from 8 ». The tab sits after « Soldes », a tab Sure lacks, so that « Vue d'ensemble » and « Échéancier » keep Sure's order side by side. « Durée » truncates to years as Sure's overview, so 30 months reads « 2 ans » there and « 30 mois » in the header. The insurance rate prints as Sure's `number_to_percentage`, three decimals rounded half up and stripped. The ring is Sure's warning colour, and the leverage band Sure's colours; Sure's success green has no token, so « Prudent » takes the income green, the closest at 4.5:1, `--trend-up` reaching 3.2:1 on a card. The end-to-end test cannot pin the server's clock, so it asserts the instalment whose number it derives from today and the figures that stay level; the route spec pins 4 October 2026.

## Verification

**Commands:**
- `pnpm --filter @archant/api exec vitest run --project unit src/domain/loans src/routes/accounts.spec.ts` -- green, 100 % branches on `domain/loans/`.
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test && pnpm test:e2e` -- green, no tracked file changed after.

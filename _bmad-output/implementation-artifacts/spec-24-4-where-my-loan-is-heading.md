---
title: 'Story 24.4: Where my loan is heading'
type: 'feature'
created: '2026-10-07'
status: 'done'
baseline_commit: '1ee8d31a19a1bd6829be413ae63d4a76ea1186a4'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-24-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The schedule of Story 24.2 says what the contract promised, the overview of Story 24.3 what is owed today, but nothing says where today's balance leads: whether an early repayment shortens the loan, by how much, and what it saves.

**Approach:** Port Sure's `Loan::PayoffProjection` (read at `14638a701`) to `domain/loans/payoff-projection.ts` and the series of `Loan::PayoffChart` to `domain/loans/payoff-chart.ts`, pure and computed on read. `GET /api/accounts/:id/payoff-chart?period=` feeds a loan chart that replaces the balance chart of a loan with a schedule, and the schedule's answer gains the projected payoff for « Fin prévue ». Story 24.4 of `epics.md` is the acceptance contract; this spec adds what reading Sure settled.

## Boundaries & Constraints

**Always:**
- Today is `today(deps.timeZone)`. The balance is `account.balance` (what is owed, AD-5). The schedule is `amortizationSchedule`, the rates `rateResolver`, the run `simulate`, never re-derived.
- Projection, as Sure's: applicable when a schedule exists, the balance is above zero and at least one payment falls after today. It walks the payments dated after today, from the last payment on or before today (else origination), with `strategy: scheduled` paying row `index`'s own payment, and `settleAtScheduleEnd: false`. `payoffDate` only when converged; `monthsSaved` = remaining dates − payments made; `interestSaved` = remaining rows' interest − the run's interest; `balloon` = what is left when not converged. Not applicable: none of these.
- Chart domain over `BALANCE_PERIODS`: a bounded period runs from max(today − months, origination) to today, at least one day; « Tout » runs from origination to the later of both payoff dates and today. A loan's chart opens on « Tout » when no period is in the URL.
- Series: `actual`, the account's daily balances (`balancesBetween`) from max(domain start, first balance) to min(domain end, today), thinned by `sampleSeries`; `scheduled`, origination at the amount borrowed then each payment's ending balance; `projected`, today at the balance then each projected payment's ending balance. A series is visible when two of its points fall in the domain or it crosses it; each is returned cut to the domain plus one point either side.
- Interface, as Sure's `loan_payoff_chart_controller` and `UI::Account::Chart`: « Solde enregistré » solid in Sure's success colour (Archant's `--trend-up`) over an area at 8 %, « Projection » dashed `4 4` in the same colour, « Échéancier du contrat » dashed `6 4` in Sure's destructive colour (`--trend-down`), monotone curves, markers thinned to one per 60 pixels, a y-axis from zero; an unlabelled dashed today line; a legend « Séries du graphique » of the visible series in Sure's order (`actual`, `scheduled`, `projected`); a tooltip snapped to the payment dates, month and year, amounts in whole units; above the chart Sure's cards « Fin prévue » (the date, then « 25 mois plus tôt que prévu » or « Conforme à l'échéancier ») and « Intérêts économisés », with Sure's comparison basis, or Sure's notice « Au remboursement actuel, ce solde n'est pas soldé à l'échéance du contrat : 1 234,56 € resteraient dus. »; below it Sure's description in text, with the change since the loan started (today's balance against the amount borrowed); « Voir le tableau » as a table of date and one column per visible series, a row per date any of them plots in the domain, « — » where a series has no point.
- « Échéancier » gains « Fin prévue »: the projected payoff date, « Non soldé à l'échéance » when not converged, « N/D » when not applicable.
- A loan without a schedule, or a failed schedule read, keeps the balance chart and its 1M default. A viewer reads the chart.

**Never:** no stored figure, migration, error code, MCP tool or export change; no re-sizing of the payment to today's balance (Sure's `reamortize`); no projection past the contract's maturity.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected |
|---|---|---|
| On contract | ING terms, balance 10 472 454, asOf 2026-10-06 | payoff 2045-12-05, months 0, interest 0 |
| Early repayment | balance 9 472 454 | payoff 2043-11-05, months 25, interest 390 600 |
| Behind | balance 10 572 454 | no payoff, balloon 141 701 |
| A cent behind | balance 10 472 455 | no payoff, balloon 1 |
| Rate change since last payment | variable, change dated after payment 70, asOf before payment 71 | first period accrues at the old rate, as the schedule's |
| Nothing owed | balance 0 or negative | not applicable |
| Finished | asOf after the last payment | not applicable |
| No schedule | loan without amount, or not a loan | `{ data: null }`; the page keeps the balance chart |
| Window | 1Y on ING, asOf 2026-10-06 | domain 2025-10-06..2026-10-06; `projected` not visible |
| All | « Tout » | domain 2020-12-05..2045-12-05; all three visible |

</frozen-after-approval>

## Code Map

- `packages/api/src/domain/loans/simulator.ts` -- `simulate` already has `scheduled` and `settleAtScheduleEnd`, written for this story; do not change it.
- `packages/api/src/domain/loans/amortization-schedule.ts`, `rate-resolver.ts`, `overview.ts` -- reuse; 24.3's `loanOverview` shows the input shape.
- `packages/api/src/domain/balances/history.ts` -- `periodRange`-like clamping, `sampleSeries`; `services/balances.ts` -- `PERIOD_MONTHS`; `services/ledger/balances.ts` -- `balancesBetween`.
- `packages/api/src/domain/dates.ts` -- `addMonths`, `addDays`, `maxDate`, `today`.
- `packages/api/src/services/loans.ts` -- `loanSchedule` gains `projectedPayoff`; add `loanPayoffChart(deps, id, period)`.
- `packages/api/src/routes/accounts.ts:80` -- `.get("/:id/payoff-chart", validated("query", balanceQuerySchema))`.
- `packages/api/src/routes/accounts.spec.ts` -- 24.2's schedule and 24.3's overview specs: `ingTerms`, pinned clock, viewer.
- `packages/app/src/components/GoalChart.tsx` -- template: `ComposedChart` on a numeric day axis, dashed `Line`, `ReferenceLine`, table toggle; `BalanceChart.tsx`, `LazyBalanceChart.tsx` -- area style, lazy loading.
- `packages/app/src/routes/_authed.accounts.$accountId.tsx` -- chart section, `period` default, `useLoanSchedule` gating.
- `packages/app/src/components/LoanSchedule.tsx` -- fourth `SummaryStrip` cell.
- `packages/app/src/lib/query-keys.ts`, `hooks/useLoanSchedule.ts` -- add `payoffChart(id, period)` under `detail(id)` and `useLoanPayoffChart`.
- `packages/app/src/locales/fr.json`; `packages/app/e2e/accounts.spec.ts:417-610`, `viewer.spec.ts`.
- `docs/sure-parity.md:61`, `EXPERIENCE.md` account detail row, `sprint-status.yaml`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/domain/loans/payoff-projection.spec.ts`, `payoff-projection.ts` -- the matrix's projection rows, red first, 100 % branches.
- [x] `packages/api/src/domain/loans/payoff-chart.spec.ts`, `payoff-chart.ts` -- domain, series, visibility, cut, red first.
- [x] `packages/api/src/routes/accounts.spec.ts` -- payoff chart on ING (all and 1Y), early repayment, null cases, viewer; schedule's `projectedPayoff` -- red first.
- [x] `packages/api/src/services/loans.ts`, `routes/accounts.ts` -- service and route.
- [x] `packages/app/src/hooks/useLoanPayoffChart.ts`, `lib/query-keys.ts`, `components/LoanChart.tsx`, `components/LazyLoanChart.tsx`, the account route, `LoanSchedule.tsx`, `locales/fr.json` -- the chart and « Fin prévue ».
- [x] `packages/app/e2e/accounts.spec.ts` -- ING chart: legend, « Aujourd'hui », summary, table, a repaid loan's savings sentence, a behind loan's balloon, « Fin prévue »; a loan without schedule keeps the balance chart; `viewer.spec.ts` -- a viewer reads the chart.
- [x] `docs/sure-parity.md`, `EXPERIENCE.md`, `sprint-status.yaml` (story and `epic-24` done).

**Acceptance Criteria:**
- Given a loan whose terms or balance change, when its page is open, then the chart and « Fin prévue » follow (queries under `detail(id)`).
- Given the finished story, when `pnpm test` and `pnpm test:e2e` run, then each acceptance criterion of Story 24.4 has a test.

## Implementation Notes

## Spec Change Log

- 2026-10-07, owner's rule « no divergence from Sure »: the interface follows Sure's chart and cards rather than the epic's sentences and DESIGN.md's accent. Colours and dashes are Sure's; the outcome reads in Sure's two cards and its notice instead of « 25 mois et 3 906,00 € d'intérêts économisés » and « 1 234,56 € restants à l'échéance »; the today line has no label, as Sure's; the summary carries Sure's change « since the loan started ». `visible` lists the series in Sure's `SERIES` order. `projectedPayoff` is `{ status, date }`, a bare date beside the two strings failing the lint's redundant union rule.

## Review Triage Log

- Applied: `projectionOf` takes `MinorUnits`, not a bare `number` (AGENTS.md, money); `useLoanPayoffChart` keeps `NOT_FOUND` inline and unretried, as `useBalanceHistory`; the converged projection is read once; Playwright now follows a term change on the open page and reads « N/D » for a loan that owes nothing.
- Rejected: the balance query a loan sends for `1M` before its account answers stays, so every other account's chart still loads beside its account; `formatWholeMoney` stays beside its only caller; the one-period projection stub a « 1A » window leaves is not drawn, as Sure clips it to nothing.

## Design Notes

Assumptions decided by Sure, the owner being unavailable. Departures left, each forced: the description is shown rather than screen-reader only and « Voir le tableau » exists, both Archant's accessibility floor (UX-DR5), where Sure has neither; every Archant period stays offered, Archant's period list being the account chart's and Sure's 5Y and 10Y windows having no Archant period; the recorded line does not grey past the cursor, Archant's charts being Recharts; text is French through i18next. A loan's chart opens on « Tout »: Sure's loan chart shows the whole life for any saved period it does not offer, its default 30 days among them, so the projection is what a borrower sees first; every Archant period stays offered as a window, where Sure trims its list. Series keep Sure's names (`actual`, `scheduled`, `projected`), colours and dashes; `--trend-up` and `--trend-down` both reach 3:1 on the card in either theme. Sure's chart has no table; UX-DR5 needs one, so it lists exactly the plotted points rather than interpolating. The end-to-end test cannot pin the server's clock, so it asserts the shape and the sentences whose figures do not depend on the day; the route spec pins 6 October 2026.

## Verification

**Commands:**
- `pnpm --filter @archant/api exec vitest run --project unit src/domain/loans src/routes/accounts.spec.ts` -- green, 100 % branches on `domain/loans/`.
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test && pnpm test:e2e` (e2e inside the `/tmp/archant-e2e.lock` lock) -- green, no tracked file changed after.

**Manual checks:**
- A screenshot of the ING loan's chart under « Tout » and « 1A »: three legible lines, the marker, the legend, the sentences.

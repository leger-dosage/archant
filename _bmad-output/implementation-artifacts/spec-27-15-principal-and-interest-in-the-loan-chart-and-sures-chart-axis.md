---
title: "Story 27.15: Principal and interest in the loan chart, and Sure's chart axis"
type: 'feature'
created: '2026-10-11'
status: 'done'
baseline_commit: '3234c20fe44f17cfe8d23e5444fa764574fe12c4'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-27-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The loan chart's tooltip gives a scheduled payment's balance but not what it repays, where Sure's `cd7cb2197` adds « Principal X · Interest Y »; and every Archant chart pads its vertical axis by Archant's own rule, so a small move on a large balance draws flat or a large one squashed, where Sure's `c3afc31fe` fills about 80 % of the height above an honesty floor (Sure read at `origin/main` `275f2f994`).

**Approach:** Carry principal and interest on each scheduled point and show them under the schedule's balance; compute each chart's vertical domain as Sure computes it for that chart, then lay Archant's round ticks inside it.

## Boundaries & Constraints

**Always:**
- `scheduledSeries` gives each payment point `principal` and `interest` in minor units; the origin point carries neither; actual and projected series unchanged, as Sure's `scheduled_series`.
- `PayoffTooltip` adds, under the scheduled balance only and only when the point carries both, a muted line « Capital : X · Intérêts : Y », amounts by `formatMoney` in the currency's decimals, words from `loanSchedule.principal` and `loanSchedule.interest`; balances stay whole units.
- Balance charts (`BalanceChart`, account and net worth, Sure's `time_series_chart`): Sure's `_d3YScale` in minor units. Mean `(min + max) / 2`; span `max(max − min, |mean| × 0.015)`; padding 12 % of the span on each side; when `min ≥ 0` and `min < mean × 0.1` the low bound becomes `min(0, low)`, when `max ≤ 0` and `max > mean × 0.1` the high bound becomes `max(0, high)`; a flat series is `value ± |value| × 0.5`, or `± 100` units of the currency (`100 × 10^decimals` minor units) at zero.
- Loan chart: Sure's `loan_payoff_chart_controller`, `[0, max × 1.05]` over the visible series, `max` 1 unit when nothing is above zero.
- Goal chart: Sure's `goal_projection_chart_controller`, `[0, yMax]`, `goalBand = max(target × 1.05, highest projection, last saved, 1 unit)`, `yMax = min(max(goalBand, highestSaved × 1.05), goalBand × 2)`; a saved line above `yMax` is clipped inside the plot, as Sure's.
- The chart draws against that domain exactly; ticks are round values (1, 2, 2.5, 5 × 10ⁿ, about five) inside it, never closer than the compact label's resolution, so two labels never read the same; no tick below zero for a series with no negative value, nor above zero for one with no positive value.

**Never:** no y-axis labels removed, though Sure draws none; no change to the x axis, the markers, the period selector or the bills page's bar chart; no `useLabelsValue` headroom, Archant draws no value labels.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Small move, small balance | 5 000,00 € → 5 050,00 € | floor 75,38 € wins, domain 4 978,27 € – 5 071,73 €, the move about 53 % of the height | none |
| Small move, large balance | 100 000,00 € → 100 050,00 € | floor 1 500,38 € wins, domain 99 094,77 € – 100 955,23 €, the move about 3 % | none |
| Flat | 4 933,90 € every day | domain 2 466,95 € – 7 400,85 € | none |
| Flat at zero | 0 € every day | domain −100 € – 100 € | none |
| Near zero | 0 € → 5 000 € | domain −600 € – 5 600 €, ticks start at 0 | none |
| Large move | 4 000 € → 5 000 € | above the floor, the move about 80 % of the height | none |
| Scheduled point | a payment after the origin | « Capital : X · Intérêts : Y », to the cent, under its balance | origin point: no line |

</frozen-after-approval>

## Code Map

- `packages/api/src/domain/loans/payoff-chart.ts:59-74` -- `point`, `scheduledSeries`: add a `ScheduledPoint` (`DailyBalance` plus optional `principal`, `interest` as `MinorUnits`); `cut` and `payoffChartSeries` keep the point type generic so the fields reach the route.
- `packages/api/src/domain/loans/amortization-schedule.ts:19` -- `SchedulePayment.principal`, `.interest` are `bigint`; convert as `point` does with `toMinorUnits(Number(…))`.
- `packages/api/src/services/loans.ts:344` -- unchanged call; the response type is inferred by Hono, so `useLoanPayoffChart` gets the fields.
- `packages/app/src/lib/chart-axis.ts` -- today `axisTicks(values)` pads by 5 % and a label-resolution floor and extends to round ticks; becomes `balanceDomain(values, currency)` (Sure's `_d3YScale`) and `axisTicks(domain, currency)` (round ticks inside, `labelResolution` and `roundStep` reused). Keep the sign rule's comment: « −10 € » under a positive series reads as an overdraft.
- `packages/app/src/components/BalanceChart.tsx:112` -- `balanceDomain`, then `axisTicks`; `YAxis domain` takes the domain, not the first and last tick.
- `packages/app/src/components/LoanChart.tsx:125-163,204-210,267-276` -- `PayoffTooltip` split line; `[0, max × 1.05]` replaces the `0`-prefixed `axisTicks` call.
- `packages/app/src/components/GoalChart.tsx:163-166,190-197` -- Sure's goal domain; `allowDataOverflow` on `YAxis` for the clip.
- `packages/app/src/locales/fr.json:761-762` -- `loanSchedule.principal` « Capital », `loanSchedule.interest` « Intérêts », reused; no new key.
- `packages/app/e2e/accounts.spec.ts:723` -- the ING mortgage test, where the tooltip is read.
- `docs/sure-parity.md:61` -- Loan row's « Later. … Story 27.15 » clause.

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/domain/loans/payoff-chart.spec.ts` -- first: `scheduledSeries` expects principal and interest on payments, none on the origin; `payoffChartSeries` keeps them through `cut` -- pins Sure's payload.
- [x] `packages/app/src/lib/chart-axis.spec.ts` -- first: rewrite for the matrix's axis rows, plus negative far from zero, crossing zero, labels never repeating at 5 000 € and 100 000 € -- the story's Vitest criterion.
- [x] `packages/api/src/domain/loans/payoff-chart.ts` -- `ScheduledPoint`, generic `cut` -- carry the split.
- [x] `packages/api/src/routes/accounts.spec.ts:2454` -- update the payoff-chart response expectations if they pin scheduled points exactly.
- [x] `packages/app/src/lib/chart-axis.ts` -- `balanceDomain`, `axisTicks(domain, currency)` -- Sure's scale, Archant's labels.
- [x] `packages/app/src/components/BalanceChart.tsx`, `LoanChart.tsx`, `GoalChart.tsx` -- each chart's Sure domain; the tooltip line.
- [x] `packages/app/e2e/accounts.spec.ts` -- in the ING test, hover a scheduled payment after the origin and expect a line matching `^Capital : \d[\d  ]*,\d\d € · Intérêts : \d[\d  ]*,\d\d €$` -- the story's Playwright criterion.
- [x] `docs/sure-parity.md` -- Loan row: the tooltip's split as Sure's `cd7cb2197`, Parity; the clause « Later. Epic 27 of Epics, Story 27.15 … » goes. The balance-chart rows say the axis follows Sure's `_d3YScale`, with Archant's round labels.

**Acceptance Criteria:**
- Given an account's or the net worth's chart, when the owner hovers it, then its labels are round, distinct, and none below zero for a balance never negative.
- Given a loan's chart under « Tout », when the owner points at the origin, then the tooltip has no « Capital » line.

## Design Notes

Sure draws no y-axis labels, so « Archant's round ticks then apply » cannot mean extending the domain to the next round tick: at 5 000 € the label resolution is 100 €, and widening to it would turn the 50 € move's domain of 93 € into 200 €, a quarter of the height instead of Sure's half. The domain stays Sure's and the ticks are an overlay inside it; on a narrow domain one or two labels show.

Sure's low bound near zero is `Math.min(0, low)`: it includes zero, it does not clamp to it, so a series from 0 € to 5 000 € has a domain from −600 €. The line keeps that geometry; the tick rule keeps « −5 € » off its labels.

## Verification

**Commands:**
- `pnpm --filter @archant/api exec vitest run src/domain/loans/payoff-chart.spec.ts src/routes/accounts.spec.ts` -- expected: pass.
- `pnpm --filter @archant/app exec vitest run src/lib/chart-axis.spec.ts` -- expected: pass.
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test && pnpm test:e2e` -- expected: all green.

**Manual checks (if no CLI):**
- Screenshot a savings account with a small move, the net worth chart, the ING mortgage tooltip on a payment and a goal chart, light and dark.

## Implementation Notes

- `axisTicks(domain, currency, values)` takes the series too: Sure's domain dips below zero for a positive series near zero, so the domain alone cannot say whether a « −5 € » tick would lie.
- The step is the round value, a whole number of label resolutions, whose tick count inside the domain is closest to five, fewer on a tie: « ≥ span / 4 » gave three labels for DESIGN.md's mock once the domain stopped stretching to round ticks.
- A domain with no multiple of the label resolution inside, such as 1 018 € to 1 025 €, gets no tick: any other would misread its own value. Recharts 3 keeps an empty `ticks` list (`ticks || niceTicks`, and `[]` is truthy), so the axis shows no label, not its own ones.
- `loanDomain` and `goalDomain` sit beside `balanceDomain` in `lib/chart-axis.ts`, so each Sure rule is tested on its own.
- The tooltip's words are `loanSchedule.columns.principal` and `loanSchedule.columns.interest`, the keys at `fr.json:761-762`.
- `LoanPayoffChartData.scheduled` in `services/loans.ts` is now `ScheduledPoint[]`: the explicit return type, not Hono's inference, was dropping the split.
- After the spec review: the axis functions take `MinorUnits`, never a bare `number`, as AGENTS.md's money rule says; `AxisDomain` stays `number`, since a padded bound falls between two cents.

## Spec Change Log

## Review Triage Log

| # | Source | Finding | Verdict | Evidence | Route |
|---|--------|---------|---------|----------|-------|
| 1 | blind, edge | Narrow-domain fallback labels a 1 020 € gridline « 1 k€ » | medium | `axisTicks` returns `ceil(low / power) * power` with `power` under the label resolution; reachable for any balance under about 5 400 € with a move under 80 € | patch |
| 2 | blind | Lone-tick test checks only the length | low | `toHaveLength(1)` let finding 1 pass | patch |
| 3 | edge | Labels repeat past 1 Md€, where compact switches to « Md € » | low | Real past 1 000 000 000 €; no household reaches it, and the fix adds a branch | reject |
| 4 | edge, blind | A negative saved line is clipped at zero on the goal chart | false | Sure's goal domain is `[0, yMax]` with a clip path: the same outcome, which the story follows | reject |
| 5 | edge | The lone tick is not a 1, 2, 2.5, 5 × 10ⁿ value | low | Folded into finding 1's fix, which ticks only multiples of the resolution | patch |
| 6 | blind | « Savings goals » row omits the goal axis | low | Only Loan, Balance history range and Net worth rows changed | patch |
| 7 | blind | French decimals in English comments and docs | low | « 1,5 % » in `chart-axis.ts` and `sure-parity.md`; direct correction | patch |
| 8 | blind | `MIN_RELATIVE_SPAN` comment says a small move draws near flat | low | A 1 % move fills about 54 % of the height (matrix row 1) | patch |
| 9 | blind | Spec deviations are not in the Spec Change Log | low | The fix edits this build's spec | reject |
| 10 | blind | Spec `in-review` while sprint status reads `in-progress` | false | Step 5 syncs both; mid-review states are expected to differ | reject |
| 11 | blind, gap | No e2e check that axis labels are distinct and never negative | medium | `dashboard.spec.ts:107` checks cents only; passing `domain` for `values` would pass every test | patch |
| 12 | blind, gap | ING tooltip test checks the split's format, not its amounts | medium | Swapped principal and interest still match the regexp | patch |
| 13 | blind | Untested currencies with 0 or 3 decimals in `axisTicks` | low | `unitOf` scales every threshold; unlikely in a euro household, and a test adds no behaviour | reject |
| 14 | blind | `principal` and `interest` optional independently | low | Sure's payload and tooltip check both the same way; no user impact | reject |

---
title: "Story 34.2: Draw charts' axes as Sure"
type: 'feature'
created: '2026-11-04'
status: 'done'
baseline_commit: 'add5141c178563afa2d6aebe6c991d99ad8b19e1'
route: 'dispatch'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `BalanceChart.tsx`, which draws the dashboard's net worth and an account's balance, labels a vertical axis with round amounts (`axisTicks`), draws horizontal grid lines and names several dates along the bottom. Sure's `time_series_chart_controller.js` (`00dd977fb`) draws no vertical axis and no grid, names only the first and last dates (`_drawXAxisLabels`, two `tickValues`), lets the curve take the card's whole width (`_margin` left and right 0), and draws a dashed vertical line with a centred dot under two points (`_drawEmpty`).

**Approach:** keep Sure's `_d3YScale` (`balanceDomain`, Story 27.15) as the hidden vertical axis's domain; drop the grid and the vertical labels; give the horizontal axis exactly the series' first and last dates, formatted by `formatShortDate`, the first anchored at its start and the last at its end; draw Sure's empty state for a single point.

## Boundaries & Constraints

**Always:** the vertical domain stays `balanceDomain`. Dates go through `formatShortDate`, so they follow the interface's language: « 14 oct. 2026 » in French, « Oct 14, 2026 » in English, Sure's `%b %d, %Y`. The tooltip, the summary line and « Voir le tableau » stay as they are; the table stays the accessible reading of the series.

**Never:** no change to `LoanChart.tsx` or `GoalChart.tsx`, which follow Sure's loan and goal controllers and keep `axisTicks` and `formatTick`; no API change; no change to the zero-point empty text `balances.empty`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| A month | 31 daily points, 2026-10-04 to 2026-11-03 | ticks `["2026-10-04", "2026-11-03"]`, read « 4 oct. 2026 » at the left edge and « 3 nov. 2026 » at the right | N/A |
| Ten years | 3 652 points, 2016-11-04 to 2026-11-03 | ticks are the first and last dates only | N/A |
| Two points | yesterday, today | both dates, one at each edge; the line is drawn | N/A |
| One point | account opened today | no axis, no area; a dashed vertical line and a dot, both centred; summary and « Voir le tableau » stay | N/A |
| No vertical axis | any series of two points or more | no amount label and no grid line in the chart | N/A |

</frozen-after-approval>

## Code Map

- `packages/app/src/components/BalanceChart.tsx` -- `Chart`: remove `CartesianGrid`, set `YAxis hide` with `domain` kept, `margin` left and right 0, `XAxis ticks={edgeDates(...)}` with `interval={0}` and a `tick` renderer that anchors the first label `start` and the last `end`; drop `LONG_RANGE_POINTS`, `axisTicks`, `formatTick`, `formatCompactMoney` and `toMinorUnits` imports if unused; the `dot` on a lone point gives way to `ChartEmpty`.
- `packages/app/src/lib/chart-axis.ts` -- add `edgeDates(points)`: the first and last `date` of a series, Sure's two `tickValues`.
- `packages/app/src/lib/chart-axis.spec.ts` -- existing tests; add `edgeDates` cases.
- `packages/app/src/lib/balance-change.ts#formatShortDate` -- `12 sept. 2026` through `intlLocale`, reused for the labels.
- `packages/app/src/lib/chart-heights.ts` -- `CHART_HEIGHTS` sizes the empty state as the chart.
- `packages/app/e2e/dashboard.spec.ts` -- test « the net worth shows its trend arrow… » asserts abbreviated vertical labels; it now reads the two dates and finds no vertical label and no grid.
- `packages/app/e2e/balance-history.spec.ts` -- an account opened today shows the empty state.
- `_bmad-output/planning-artifacts/ux-designs/ux-archant-2026-09-21/DESIGN.md` « Net worth card » -- still names gridlines and « 275 k€ » axis labels.
- `docs/sure-parity.md` « Balance history range » and « Net worth » rows -- the Story 34.2 « Later » becomes Parity.

## Tasks & Acceptance

**Execution:**
- [x] `packages/app/src/lib/chart-axis.spec.ts` -- failing tests first: `edgeDates` over a month, over ten years, over two points.
- [x] `packages/app/src/lib/chart-axis.ts` -- `edgeDates`.
- [x] `packages/app/src/components/BalanceChart.tsx` -- hidden vertical axis on `balanceDomain`, no grid, zero side margins, two anchored date labels, `ChartEmpty` (an SVG: dashed centred line in `--border`, Sure's `4, 4` dashes, 8 px dot in the muted text colour, `aria-hidden`, height `CHART_HEIGHTS[height]`) for one point.
- [x] `packages/app/e2e/dashboard.spec.ts` -- the two labels equal the first and last dates of `api.netWorth().points` in French, the first starts inside the chart's left edge and the last ends inside its right edge; no `€` tick and no `.recharts-cartesian-grid`.
- [x] `packages/app/e2e/balance-history.spec.ts` -- an account opened today shows the dashed line and the dot, and « Voir le tableau » still lists its day.
- [x] `DESIGN.md` « Net worth card » -- no grid, first and last dates only, as Sure.
- [x] `docs/sure-parity.md` -- both rows.

**Acceptance Criteria:**
- Given the net worth chart or an account's balance chart, when it draws, then it shows no vertical label and no grid line, and its vertical scale is still `balanceDomain`.
- Given the same chart, when it draws its horizontal axis, then it names only the first and last dates, in the interface's language, the first inside the left edge and the last inside the right edge.
- Given a series of one point, when the chart renders, then it shows a dashed vertical line and a centred dot.
- Given the finished story, when `pnpm test` and `pnpm test:e2e` run, then both pass.

## Implementation Notes

- Assumption: labels anchor `start` and `end` rather than Sure's `middle` with a 5 em shift; the story asks for each label inside its edge, and a fixed shift would overflow a short French date or leave a gap on a long one.
- The two dates carry `data-slot="axis-date"` and the empty state `chart-empty`, `chart-empty-line` and `chart-empty-dot`: the empty state is `aria-hidden`, so no role reaches it, and a class would tie the tests to styling.
- The empty state is an SVG so its dashes are Sure's `4, 4`; a CSS dashed border draws 1 px dashes.
- Assumption: the table toggle stays under the empty state, as the accessibility floor (EXPERIENCE.md) asks for every chart; Sure has no table.

## Spec Change Log

- Ten-year row: 3 652 points, not 3 653; ten years from 2016-11-04 hold two leap days and end the day before the tenth anniversary. Factual fix, no change of intent.

## Review Triage Log

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | The e2e test located the empty state by Tailwind classes | low | patch | `data-slot` on the line and the dot. |
| 2 | `EdgeTick` took a `first` prop where Recharts gives `index` | low | patch | Anchors by `index`; no Recharts class written by hand. |
| 3 | Computations ran before the one-point early return | low | patch | Moved after it; `useId` stays first. |
| 4 | `formatShortDate`'s doc named only sentences | low | patch | Now names the axis too. |
| 5 | A CSS dashed border is not Sure's `4, 4` dash | low | patch | SVG `line` with `strokeDasharray="4 4"`. |
| 6 | The e2e test did not look for a `€` label | low | patch | `chart.getByText(/€$/u)` has count 0. |
| 7 | Ten-year matrix row said 3 653 points | low | spec fix | Spec Change Log. |
| 8 | Top margin 8 where Sure has 20 with labels | — | reject | Out of the story's scope; the vertical scale is unchanged. |
| 9 | No test that two points draw a line with both labels inside | — | reject | `edgeDates` covers two points; the dashboard test checks both edges on a real series. |

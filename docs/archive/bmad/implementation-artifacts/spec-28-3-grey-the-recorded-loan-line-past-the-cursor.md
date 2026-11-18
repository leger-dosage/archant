---
title: 'Story 28.3: Grey the recorded loan line past the cursor'
type: 'feature'
created: '2026-10-14'
status: 'done'
baseline_commit: '24f44572007777f5641e24aacd1b343eb9e46d7c'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-28-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** On a loan's payoff chart, « Solde enregistré » stays one colour whatever the cursor does. Sure `00dd977fb` (`app/javascript/controllers/loan_payoff_chart_controller.js:177-200,277-290,445-475`) draws the recorded line twice, each under a clip path sharing one edge: coloured up to the hovered date, greyed past it, the edge back at the window's end at rest.

**Approach:** The same two clips in `LoanChart.tsx`, their edge the x of the date the tooltip already snaps to, read from Recharts 3's own hooks inside the chart; the area fill and the forecast lines unchanged.

**Scope decision (owner, 2026-10-14):** the story first also trimmed the loan chart's periods to Sure's `Loan::PayoffChart::WINDOW_KEYS` with a fallback to « Tout ». Archant has none of Sure's period keys (`BALANCE_PERIODS` is `1M, 3M, 6M, 1Y, all`) and saves no period, so that part moved to Story 34.3, which brings both.

## Boundaries & Constraints

**Always:**
- Only « Solde enregistré » splits. « Échéancier du contrat » and « Projection » keep one style, as Sure's forecasts.
- The split date is the tooltip's: `nearestDate(stops, …)` of the hovered day, the scheduled payment dates inside the window else every plotted date, as `PayoffTooltip` and Sure's `snap`. Its x is clamped to the plot, as Sure's `Math.max(margin.left, Math.min(px, width - margin.right))`.
- Keyboard traversal moves the split as the pointer does: Recharts' `accessibilityLayer` already moves the active tooltip, and the split reads the active tooltip, so both inputs share one path, as Sure's `showAt`.
- At rest (no active tooltip) the edge sits at the plot's right end: the whole recorded line is coloured, the greyed copy has zero width.
- The greyed copy is Sure's: same path, same width, Sure's `--color-tertiary` at opacity 0.6, here `var(--border)` (`#e9e8ea` light, `#323336` dark, Sure's alpha-black-100 and alpha-white-200 on a card), drawn under the coloured one. The area fill stays whole under the plot clip, as Sure's.
- The coloured copy keeps markers and the active dot; the greyed copy has neither.
- Clip ids unique per chart (`useId()`), as Sure's `clipSerial`: two charts on one page never share a clip.

**Never:** no change to the period selector, `PeriodToggle`, `BALANCE_PERIODS` or the payoff-chart route (Story 34.3); no new dependency; no D3; no change to the tooltip's content or to the balance chart of other accounts.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Hover mid-chart | cursor at 40 % of the plot | coloured line up to the nearest payment date's x, greyed past it | none |
| Rest | no cursor, no focus | whole line coloured, greyed clip width 0 | none |
| Leave | cursor leaves the plot | back to rest | none |
| Keyboard | arrow keys on the focused chart | split follows the active payment date | none |
| Hover before the recorded history | split date before the first recorded point | whole recorded line greyed | none |
| Hover past today | split date after today, window « Tout » | whole recorded line coloured | none |
| Window without payments | « 1 M » with no payment inside | split snaps to the nearest plotted date | none |
| Snap outside the plot | nearest stop beyond the window's edge | edge clamped to the plot's left or right | none |

</frozen-after-approval>

## Code Map

- `packages/app/src/components/LoanChart.tsx:88-97` -- `nearestDate`; `:228-231` -- `stops`, built in `Chart`; both now also feed the split.
- `packages/app/src/components/LoanChart.tsx:307-321` -- the `actual` `Area`: keeps its fill with `stroke="none"`; two `Line`s on `dataKey="actual"` draw the stroke, greyed under the future clip then coloured under the past clip.
- New `packages/app/src/lib/payoff-cursor.ts` -- `nearestDate` moved from `LoanChart.tsx`, plus `splitDay(label, stops, domain)`: the snapped day in UTC-midnight milliseconds, or `domain.to` at rest. Pure, so Vitest covers it without a chart.
- New component inside `LoanChart.tsx`, rendered as a child of `ComposedChart` -- reads `useActiveTooltipLabel()`, `useXAxisScale()` and `usePlotArea()` (Recharts 3.10, exported from `recharts`) and renders the `<defs>` with the two `clipPath` rects, as Sure's `pastClip` and `futureClip`.
- `packages/app/e2e/accounts.spec.ts:810-902` -- the ING mortgage test already hovers the plot at 40 %; the split assertions go there.
- `docs/sure-parity.md:63` -- the « Story 28.3 » Later clause becomes Parity.

## Tasks & Acceptance

**Execution:**
- [x] `packages/app/src/lib/payoff-cursor.spec.ts` -- the matrix's snapping rows as failing tests: snapped to the nearest stop, the window's end at rest, plotted dates when no payment is in the window; the edge clamp lives in `SplitClips`' pixels, since stops never leave the window -- test-first.
- [x] `packages/app/e2e/accounts.spec.ts` -- in the ING mortgage test, after the 40 % hover: the greyed copy (`[data-series-shadow="actual"]`, as Sure's) is visible and its clip rect starts within a few pixels of the hovered payment; after `page.mouse.move(0, 0)`, that rect has zero width. Fails first.
- [x] `packages/app/src/lib/payoff-cursor.ts` -- `nearestDate` and `splitDay`; `LoanChart.tsx` imports `nearestDate` from it.
- [x] `packages/app/src/components/LoanChart.tsx` -- the clips component, the area's stroke moved to two clipped `Line`s, `data-series="actual"` on the coloured one and `data-series-shadow="actual"` on the greyed one.
- [x] `docs/sure-parity.md` -- the clause to Parity.

**Acceptance Criteria:**
- Given a loan with a schedule, when the cursor rests on the chart, then « Solde enregistré » is coloured up to the tooltip's date and greyed past it, and the contract and projection lines are not split.
- Given the cursor leaves the chart, when nothing is hovered or focused, then the whole recorded line is coloured.
- Given the chart focused, when an arrow key moves the tooltip, then the split follows it.
- Given the finished story, when `pnpm test` and `pnpm test:e2e` run, then Vitest covers `splitDay` and Playwright covers hover and leave.

## Implementation Notes

- Recharts 3.10 sets a `Line` path's own `clip-path` to the plot's, so each copy goes through the `shape` prop: a `<g>` carrying the split clip and the `data-series` attributes around `LineDrawShape` (`tagged` in `LoanChart.tsx`).
- `atMidnight`, `isoOf` and the tooltip's stop rule (`payoffStops`) moved to `lib/payoff-cursor.ts` with `nearestDate`, so the tooltip and the split share one source.
- The ING mortgage's recorded line is flat, which Playwright never calls visible: the e2e test reads the two clip rects instead.

## Spec Change Log

## Review Triage Log

| Layer | Finding | Verdict | Evidence / route |
|-------|---------|---------|------------------|
| blind, edge | Markers of the coloured line are not clipped past the cursor | false | Sure draws its markers under `plotClip` only (`loan_payoff_chart_controller.js:303-312`); same here. |
| gap | The coloured copy's `-past` clip is never asserted | medium | Removing it passes every check. Patched: `pastClip()` in the e2e test. |
| gap, blind, edge | The hover asserts the edge near the pointer, not near the snapped payment | medium | Under « Tout » payments are ~2 px apart. Patched: a hover on « 1 A » checks the payment's x. |
| blind, edge | The keyboard step proves only that the split left rest | low | Patched: a second step moves the edge right; blur returns to rest. |
| edge | `shadow.evaluate` waits silently when the shadow is missing | low | Patched: count asserted first. |
| blind | `splitDay`'s domain clamp is unreachable | low | `payoffStops` keeps only stops inside the same window; the pixel clamp stays. Patched: deleted. |
| blind | `useId` sanitising has no why-comment | low | React 19 ids (`_r_1k_`) are valid in `url(#…)`, so the sanitising went instead. |
| blind | Parity row records the change in the Archant column only, and the 34.3 clause omits « Tout » | low | Patched. |
| blind | Keyboard steps one data row per press, Sure one stop | low | Pre-existing: Recharts' `accessibilityLayer` drove the tooltip before this story. Deferred. |
| blind | Matrix rows « before history » and « past today » untested | low | Both follow from one shared edge, which the past and future clip assertions pin; rejected. |
| blind | Empty stops return the hovered day | false | No stop means no plotted date in the window: nothing to split. |
| blind | A string label reads as rest | false | The x axis is `type="number"`; its label is always a number. |
| blind, edge | A one-point recorded series renders no `data-series` | false | One point draws no line in Recharts, before as after; nothing to grey. |
| blind | Spec and sprint statuses disagree | false | The workflow sets both to `done` at completion. |
| blind | Spec's Code Map and tasks omit `payoffStops`, `atMidnight`, `isoOf` and the `<g>` choice | false | Fix edits this spec; recorded under Implementation Notes. |
| blind | `sure-departures-review-2026-10-12.md` still names the old scope | false | A dated review record; `epics.md` carries the current scope. |
| blind | No screenshots beside Sure | false | Done in the QA pass. |

## Design Notes

The existing e2e assertion `card.locator(".recharts-line")).toHaveCount(2)` becomes 4: the two forecasts plus the two copies of the recorded line. Sure's own browser test counts `[data-series]`, which stays at three; prefer that count.

If a clip-path attribute on a Recharts `Line` does not reach its `path` in 3.10, wrap each copy in a `<g clipPath=…>` through the `shape` prop or clip a `Customized` layer; check in the browser before choosing.

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test && pnpm test:e2e` -- expected: all green, no tracked file changed after.

**Manual checks:**
- Screenshots of the ING loan chart at rest, hovered at 40 % and focused with an arrow key, light and dark themes, set beside Sure's chart in self-review and QA.

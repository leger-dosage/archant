## 1. Implementation

- [x] 1.1 Replace the 90-day balance change in `services/goals.ts` and `domain/goals.ts` with grouped net inflows, including accounts linked before deactivation.
- [x] 1.2 Use year-over-year balance changes for valuation-tracked accounts. Report unknown pace separately from measured zero in goal summaries, status and projections.
- [x] 1.3 Scale the 90-day historical balances by today's backing ratio in `getGoalHistory` and update the chart and status text in both supported languages.

## 2. Verification

- [x] 2.1 Vitest covers internal transfers, excluded and pending lines, the valuation fallback, an account with no measurable history, a measured zero, a deactivated account and the scaled series. Playwright checks measured and unknown pace, including an absent projection.
- [x] 2.2 Run the repository verification commands.

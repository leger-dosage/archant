## 1. Implementation

- [x] 1.1 Store the expense-based target when its inputs change and retire the target recalculation in `listGoals`. Replace the fixed month cap with a bound that keeps the target a safe integer.
- [x] 1.2 Refresh eligible stored targets once per calendar month in the signed-in daily work, including after downtime. Keep the previous target when the median is missing or the product is invalid.

## 2. Verification

- [x] 2.1 Vitest covers a target-setting edit, an unrelated edit, a catch-up refresh after downtime, repeated and concurrent requests, rollback and retry, an invalid refresh and the safe-integer bound. Playwright reads the hint and stored target.
- [ ] 2.2 Run the repository verification commands.

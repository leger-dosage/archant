## 1. Implementation

- [ ] 1.1 Implement the budgets delta (start on the twenty-fifth, keep calendar months when the start day is one, resolve a month slug).
- [ ] 1.2 `budgets` stores each period's start and end dates, as Sure's `start_date` and `end_date`, unique per household; a migration gives every existing month its calendar dates.

## 2. Verification

- [ ] 2.1 Vitest covers a date before and after the start day, a start day of 28 across February, the slug round trip, the bounds and the name; Playwright opens a budget with a start day of 25 and reads its name and its period's transactions.
- [ ] 2.2 Run the repository verification commands.

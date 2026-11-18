## Approach

Compute the cash summary from current balances and active goal allocations. Keep it separate from the selected budget period and its allocation arithmetic.

`GET /api/budgets/available-cash` reads reporting depository accounts as of today. It uses `backingShares` to divide each balance among the goals that still hold it. Its interface query is grouped with the account and goal queries so changes to either refresh the cash figures.

## Source

Story 35.4 in `docs/archive/bmad/planning-artifacts/epics.md` records the original acceptance criteria and the Sure references.

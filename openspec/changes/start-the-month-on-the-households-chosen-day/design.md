## Approach

Resolve the budget slug to the month containing the period start. Migrate existing budgets to calendar boundaries and use the same period resolver in the interface and assistant tools.

Use the contract introduced by `household-preferences` (Story 36.6).

## Implementation constraints

- `budgets` stores each period's start and end dates, as Sure's `start_date` and `end_date`, unique per household; a migration gives every existing month its calendar dates.

## Source

Story 35.1 in `docs/archive/bmad/planning-artifacts/epics.md` records the original acceptance criteria and the Sure references.

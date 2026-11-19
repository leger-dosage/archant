## Approach

Resolve the budget slug to the month containing the period start. Migrate existing budgets to calendar boundaries. Keep the dates of a saved budget when the preference changes. The budget service resolves both explicit slugs and the current period for the interface and the assistant tools. A slug selects the same saved budget regardless of how it is opened.

Use the contract introduced by `household-preferences` (Story 36.6).

## Implementation constraints

- `budgets` stores the start and end dates. Both dates and the month slug are unique within the household.
- Actuals, transaction links and carry use the saved dates. A change to the start day can introduce gaps or overlaps between saved periods. Suggestions group the household's whole history by the first day of the period being viewed. Reports and savings goals keep their existing calendar-month statistics.
- Opening an unset period computes actuals and suggestions without saving. The first write records its dates; later writes preserve them.

## Source

Story 35.1 in `docs/archive/bmad/planning-artifacts/epics.md` records the original acceptance criteria and the Sure references.

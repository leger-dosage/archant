## Approach

Keep partial writes and rollover recomputation in the same transaction in `services/budgets.ts`. Distinguish a stored budget record from an initialized budget with planned spending, and use stored-record existence when listing earlier months. Keep reads non-mutating and continue parsing amounts to integer minor units.

## Source

Story 35.3 in `docs/archive/bmad/planning-artifacts/epics.md` records the original acceptance criteria and the Sure references.

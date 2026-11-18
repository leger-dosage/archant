## Approach

Record spending and update its account allocation together. Exclude claimed, pending and excluded outflows when presenting suggestions.

The immediate write transaction rechecks the goal, its funding and the booked debit. A claim stamp remains on the transaction after the goal is deleted or reopened and follows a manual duplicate merge. Existing goals start with no consumed money and existing outflows start unclaimed. The eligible threshold is 100 major units in the goal's currency, as Sure's flat cutoff. Archant already requires linked accounts to use that currency.

Completion freezes the funded amount while retaining what the goal consumed. Reopening a completed lifecycle clears both amounts. Restoring an archive made before completion retains its spending. The pace and history continue to measure account activity and backing.

## Source

Story 35.7 in `docs/archive/bmad/planning-artifacts/epics.md` records the original acceptance criteria and the Sure references.

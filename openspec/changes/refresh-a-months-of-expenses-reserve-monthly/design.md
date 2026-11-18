## Approach

Calculate and store the target when the expense mode or its number of months changes. Read the persisted target in `listGoals`, so editing the name does not refresh it. Use the signed-in daily work after the response to start an idempotent refresh once per calendar month in household time. Refresh existing eligible reserves after upgrade as part of that same monthly work. Keep the previous value if the refresh cannot produce a positive safe integer.

The middleware schedules the work after the signed-in read. The refresh reads the calendar month in household time and records it in `settings` in the same immediate transaction as the target updates. Concurrent requests in one process share the attempt. Independent processes check the month again under the write lock. A failed transaction leaves the month due.

The goal keeps its stored amount and the detail page shows the median used to set that amount. If several valid targets add up to an amount outside the safe integer range, the dashboard keeps the individual goals and omits the combined target. The progress chart stays within the safe minor-unit range.

## Source

Story 35.12 in `docs/archive/bmad/planning-artifacts/epics.md` records the original acceptance criteria and the Sure references.

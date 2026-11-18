## 1. Implementation

- [x] 1.1 Add status filters and name search to the active and completed grid while keeping the archive separate. Calculate the indicator figures from the goal pace data and account movements independently of the selected filters.

## 2. Verification

- [x] 2.1 Vitest covers the three indicators with a paused goal, a reserve and a dated goal whose pace is unknown. Playwright filters by a chip and searches by name.
- [ ] 2.2 Run the repository verification commands.

The local `pnpm test` run timed out after 5,000 ms in the existing 29-year trade export test in `packages/api/src/services/export.spec.ts`. The test passed when run on its own. The volume tests, app unit tests and focused goals Playwright suite passed separately. The complete Playwright run was stopped after 81 passes to free the shared machine. The complete GitHub checks remain pending.

## 1. Implementation

- [x] 1.1 Add `/plan` and its budget and goal summaries. Point desktop and phone navigation and existing breadcrumbs at Plan.
- [x] 1.2 Remove the dashboard goals card and resolve layouts saved with its section key. Keep the goals list reachable when the household has only completed or archived goals.

## 2. Verification

- [x] 2.1 Vitest covers the top categories' order, the goals totals and a saved layout with the retired section key. Playwright opens Plan on desktop and phone, reaches a budget and the goals list, and reads the dashboard without a goals card.
- [ ] 2.2 Run the repository verification commands.

The targeted browser scenarios passed. The full browser suite stopped after an account-editing timeout that passed on retry. Confirm the full browser and volume suites in GitHub Actions before syncing and archiving this change.

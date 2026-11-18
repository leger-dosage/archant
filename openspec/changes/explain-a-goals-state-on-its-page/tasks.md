## 1. Implementation

- [x] 1.1 Use the goal's state, target and pace in its status header, action panel and projection summary. Reuse the existing goal edit and lifecycle operations for the new controls.

## 2. Verification

- [x] 2.1 Vitest covers each status line and panel; Playwright reads them for a goal behind, one with unknown pace and a reached one.
- [ ] 2.2 Run the repository verification commands. The full Playwright suite is pending in GitHub Actions.

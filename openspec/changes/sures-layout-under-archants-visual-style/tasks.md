## 1. Implementation

- [x] 1.1 Move existing snapshot and trade editing into responsive drawers, and apply that layout to existing transactions. Keep creation in dialogs, including the new transaction path.
- [x] 1.2 Save each editor's notes on blur through a note-only update. Add trade note support and keep edits to values and dates in their own forms.
- [x] 1.3 Lay out three loan summary cards at 390 px without truncating amounts or causing horizontal overflow.

## 2. Verification

- [x] 2.1 Verify creation dialogs, wide and centred edit drawers, independent note persistence in all three editors, and loan cards with a long amount at 390 px and a narrower or zoomed layout.
- [ ] 2.2 Run the repository verification commands.

## Local verification

The static checks, data and app tests, API unit tests with ledger coverage, and all 28 volume tests on an isolated retry passed. Eleven targeted Chromium tests passed on port 8809 after the drawer and split-action corrections. The complete Chromium run before those corrections had 559 passes, four failures and 25 dependent tests that did not run. The four failed tests passed on the targeted rerun, including the shell navigation test without changes to the shell. The complete Chromium suite still needs a passing run on the final tree before syncing and archiving.

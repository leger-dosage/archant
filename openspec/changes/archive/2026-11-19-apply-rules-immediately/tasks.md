## 1. Test the write paths

- [x] 1.1 Add route and assistant tests that fail on the baseline for immediate execution, order, changed IDs and opt-out. Add a browser journey that saves the option and creates a matching transaction.

## 2. Implement immediate execution

- [x] 2.1 Persist `applyImmediately` through rule saves and household archives. Verify defaults, partial saves and archive round trips.
- [x] 2.2 Wire creation, edits and bulk categorisation to the ordered engine. Verify history, lock and stop behavior, unchanged writes, and the scope of transfer matching.
- [x] 2.3 Add the switch and the immediate history label. Verify them in the browser.

## 3. Close the change

- [x] 3.1 Review against the spec and repository standards, update Sure parity, and validate the synced reference spec and archive.

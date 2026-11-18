## 1. Ordering and execution

- [x] 1.1 Add and backfill persistent rule order and the stop flag. Gate the reorder operation and stop flag with the same permissions as editing a rule. Preserve both in the rule reader and archive round trip.
- [x] 1.2 Share field claims and per-transaction stopping across the preview planner and the execution path. Preserve additive tags, attribute locks, savepoints and run history.
- [x] 1.3 Apply the saved order after imports and bank sync. Include enabled predecessors when previewing or applying a single rule.

## 2. Interface and verification

- [x] 2.1 Add accessible reorder controls and a stop toggle in both languages. Verify that touch and keyboard can save an order.
- [x] 2.2 Verify upgraded installations, archive round trips, changed precedence after reorder, unchanged or locked values, additive tags, manual preview and automatic runs against overlapping rules.
- [ ] 2.3 Run the repository verification commands.

The complete browser run on base `11b95d38` passed 571 tests. The dashboard
drag-and-drop test timed out waiting for the layout save, and 17 dependent
tests did not run. The same timeout reproduced on unmodified `11b95d38`.
After rebasing onto `e29b1111`, which fixes that test, all 61 selected
Chromium tests passed, including rules, budgets, reports and layout.
The complete browser run on the updated base remains pending.

## 1. Implementation

- [x] 1.1 Store pledges and expose the form, pending status, extend and cancel actions, most recent matched deposit date and catch-up amount.
- [ ] 1.2 Reconcile eligible booked inflows after commit across bank sync, application transfers and investment cash deposits. Use the cash balance increase for manual savings snapshots and prevent a source from matching twice.

## 2. Verification

- [ ] 2.1 Vitest covers both tolerances, the window, two pledges on one inflow, retries and rollback, a manual cash snapshot, expiry and extension. Cover transfers booked directly, through a new match and through a rule, plus investment cash deposits and ineligible trades. Playwright records, extends and cancels a pledge.
- [ ] 2.2 Run the repository verification commands.

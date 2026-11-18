## 1. Implementation

- [x] 1.1 Store pledges and expose the form, pending status, extend and cancel actions, most recent matched deposit date and catch-up amount.
- [x] 1.2 Reconcile eligible booked inflows after commit across bank sync, application transfers and investment cash deposits. Use the cash balance increase for manual savings snapshots and prevent a source from matching twice.

## 2. Verification

- [x] 2.1 Vitest covers both tolerances, the window, two pledges on one inflow, retries and rollback, a manual cash snapshot, expiry and extension. Cover newly booked direct and imported transfers, investment cash deposits and ineligible trades. Verify that manual matches and rules pairing already booked entries leave pledges unchanged. Playwright records, extends and cancels a pledge.
- [x] 2.2 Run the repository verification commands.

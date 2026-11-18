## Approach

Persist pledge state and expiry. Reconcile committed inflows and manual cash snapshot increases against the oldest eligible pledge. Route newly booked transfer inflows through the shared ledger booking paths. Manual matching and transfer rules pair existing entries in Archant. They leave pledges as they are because the deposit is handled when it is booked. Sure can also create a missing side during matching or rule application. Archant's transfer rules avoid creating a mirror that could duplicate the other bank statement's line (AD-11). Match after commit so a reconciliation failure leaves the booked transfer intact. Guard the pledge and its source together so retrying a booking cannot claim it twice.

Use the contract introduced by `a-goals-pace-and-history-as-sure` (Story 35.9).

## Source

Story 35.6 in `docs/archive/bmad/planning-artifacts/epics.md` records the original acceptance criteria. [Sure #4381](https://github.com/we-promise/sure/pull/4381) adds reconciliation of newly booked transfers and deposits.

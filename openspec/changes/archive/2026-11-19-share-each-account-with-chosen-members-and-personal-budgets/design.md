## Approach

Backfill ownership and shares before enforcing account scope. Apply the same scope across financial reads and writes, and use the account inclusion preference when building budgets and reports.

Use the contract introduced by `a-member-who-writes-and-a-guest-as-sures` (Story 36.2).

The administrator-only archive keeps its existing household ledger scope and exports the shared budget. Database backups keep account ownership, personal budgets and grants, which depend on the users of this instance. A personal budget grant exposes the owner's totals. Opening an individual transaction still requires its account grant.

Manual recurring detection, payment matching and cleanup process the caller’s editable accounts. Series with no assigned account require full ledger access for these manual passes. Scheduled detection still works across the household, and scheduled rules evaluate only accounts their author can edit. Rules triggered by a transaction write require edit access for both the author and the writer. Rules with a reference to an inaccessible account stay out of the member’s rule list. Category, merchant and tag maintenance checks every affected ledger, recurring and budget reference before changing it.

## Source

Story 36.4 in `docs/archive/bmad/planning-artifacts/epics.md` records the original acceptance criteria and the Sure references.

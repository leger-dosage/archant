## Context

Sure's `Entry#reconciled_status` is a manual checklist for unlinked accounts. It is distinct from a transaction matched to an imported statement. Archant already uses the word reconciliation for a dated balance valuation. The three states in this proposal belong to transactions.

## Decisions

- Store one status on the transaction's entry with a database constraint and a default of unreconciled. Store the opt-in in household settings. If household access changes ship first, use the same account-level permissions for reconciliation as for other transaction edits.
- Reuse the transaction list filter and bulk-edit paths. Validate eligibility on the server, including the household switch, account link and existing split visibility rules. Skip bank-linked rows in a bulk selection as Sure does.
- A status change alone adds no field lock and triggers no balance recomputation. Carry the state through Archant's own export metadata so a backup restores the checklist. Old archives and rows start unreconciled. If statements later acquire their own records, they can reference evidence independently.

## Context

[Sure #4347](https://github.com/we-promise/sure/pull/4347) explicitly triggers a job after web, bulk, REST and assistant writes. It skips unchanged input and runs the ordered prefix through the last active immediate rule. Ordinary predecessors still enforce claims and stops. Sure defers email actions on those predecessors. Archant has no email or asynchronous rule actions.

## Goals / Non-Goals

Use the shared transaction services for the corresponding writes. Imports and provider sync keep their existing scheduled run. Split, transfer and reconciliation workflows keep their existing entry points.

## Decisions

- Persist `applyImmediately` with a false default and expose it in the rule form and rule data. Restore the setting from Sure-compatible exports when present.
- Call the rule runner after the initiating write succeeds. Run it synchronously and separately so the response can read the resulting transaction and a rule failure does not roll back the user's write. Keep this call outside the rule writer to avoid recursion.
- Reuse `runInTurn`, which handles attribute locks, saved order and stop flags. Read only changed entries in bounded queries. Record matching turns as immediate runs. When an immediate rule changes a transfer expectation, let the existing matcher write only matches involving an affected entry.
- For edits, use the ledger's comparison with the saved values. For bulk category assignment and bulk edits, keep the exact IDs with changed transaction fields. Reconciliation bookkeeping alone does not trigger the runner. The transaction editor sends modified fields and the starting tags beside its selection, since saving a note can already have triggered rules while the editor stays open.

## Risks / Trade-offs

The write waits for matching rules to finish. Loading only the entries that changed keeps a single edit independent of the size of transaction history for ordinary rules. A failure is recorded by code without transaction data.

## Migration Plan

Add the false-default column and allow the immediate execution type in the run-history constraint. Existing rules and runs retain their values.

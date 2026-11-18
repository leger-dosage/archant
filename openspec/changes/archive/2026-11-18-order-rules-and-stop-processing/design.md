## Context

`services/rule-reader.ts` reads by creation date and ID. `services/rules.ts` already runs sequentially with one savepoint per rule. Preview and execution need to agree on the new precedence, including which rules run when one is explicitly requested.

## Decisions

- Backfill the order using the current creation-date and ID ordering, and default stop to off. Save a reordered list atomically. Appending a rule and replacing an order must use the same database write coordination.
- Keep the ledger's attribute locks and savepoints. Share the matching, claim and stop decisions across preview and execution. Evaluate each rule against the changes its predecessors made and freeze the matches for all actions of that rule. Keep claims for the matching rows on a failed rule so lower rules cannot take precedence mid-run. Tags do not claim the tag attribute.
- Preserve the existing distinction between explicit apply-all and automatic runs. An explicit single-rule preview or run includes active predecessors and skips its successors. On import and sync only enabled rules run. Keep failure messages sanitised.
- Use Sure's archive fields `position` and `stop_processing`. Preserve order and flags in Archant round trips and default both fields for older archives. Rule groups and new condition operators belong to separate changes.

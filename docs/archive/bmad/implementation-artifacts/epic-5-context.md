# Epic 5 Context: Internal transfers

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Money moved between two of the user's own accounts is recognised as a transfer, so a move to the Livret A or a credit card repayment stops counting as both an expense and an income. The user can link the outflow and the inflow by hand, undo a link, and reject a wrong one for good; after an import or a manual entry, the system links the obvious pairs by itself. This epic also defines, once, what counts as income, expense or transfer: the transaction list's direction filter uses it now, and the Epic 6 dashboard and the Epic 7 loan and investment payments reuse it unchanged.

## Stories

- Story 5.1: Mark two transactions as a transfer
- Story 5.2: Automatic transfer matching

## Requirements & Constraints

- A candidate for a transaction has the opposite amount, sits in a different account in the same currency, is dated within 4 days, is not already in a transfer, and does not form a rejected pair with it. The window is inclusive: 4 days matches, 5 does not.
- Manual match: from a transaction, "match as transfer" lists its candidates and the user picks one. Once saved, both sides show the other account.
- Undo returns both transactions to standard. Reject undoes the match and records the pair so it is never proposed again, whether by hand or automatically.
- Automatic matching runs on new transactions from an import or a manual entry. It links a transaction only when that transaction has exactly one candidate and that candidate has exactly one candidate. With two or more candidates nothing is linked, and the transaction shows a suggestion to match by hand.
- The transaction list gains a direction filter: income, expense, transfer. Internal moves and credit card payments appear under transfer.
- Transfer matching is a money path: its domain logic is covered to the branch. Every acceptance criterion has an automated test, Playwright for what the interface shows, Vitest for the rest.

## Technical Decisions

- Data model, as in Sure: `transfers (id, outflow_transaction_id, inflow_transaction_id, kind)` with each transaction in at most one transfer, and `rejected_transfers` for refused pairs. Never a flag on one side. Tables are plural snake_case, ids text UUID v4, and `kind` is a text column with a check constraint built from a `const` array in `@archant/data`; derived types go in `packages/data/types.ts`.
- Kind derives from the inflow account's type: credit card gives `credit_card_payment`, loan gives `loan_payment`, investment gives `investment_contribution`, anything else `internal_move`. Epic 5 exercises the first and last; the other two exist for Epic 7.
- Only `services/ledger.ts` writes `transfers` and `rejected_transfers`. Manual match, undo and reject are ledger functions taking an `origin`, each in one `behavior: "immediate"` transaction. Foreign keys onto `transactions` are `ON DELETE RESTRICT`.
- Deleting either side, or editing its amount, account or currency, deletes the transfer in the same transaction. This covers single and bulk delete, account deletion and import revert. `ledger.absorb` moves a transfer onto the surviving entry, since entry ids never change.
- Candidate search lives in the pure `domain/transfer-matching.ts`, shared by the manual picker and the automatic matcher so both use one window. Automatic matching is step 6 of `ledger.ingest`, after rules (step 5, still a no-op) and before the statement balance and balance recompute, so a dry-run preview and the confirmed import agree. Matching runs per account inside the ingest transaction; mutual uniqueness keeps the result independent of the order accounts are imported.
- `domain/cash-flow.ts` exports `countsInCashFlow(tx)` and `direction(tx)`, returning `income`, `expense` or `transfer`. A transaction does not count when it is excluded, pending, on an account excluded from reports, or part of a transfer, except the outflow side of a `loan_payment` or `investment_contribution`, which counts as an expense. Counted transactions take their direction from the amount's sign; uncounted transfer sides are `transfer`. The direction filter goes through the one query builder in `services/reports.ts` that Epic 6 reuses, never a second copy of the rule.
- Amounts are signed from the account's point of view (negative leaves the account), so the outflow is the negative side on assets and liabilities alike. Money stays integer minor units.
- Epic 8's future "mark as transfer" rule action may only set an expectation that this step-6 matcher reads; it never creates a transfer.
- API: the `{ data }` / `{ error }` envelope, chained mounts in `app.ts`, request schemas in `packages/api/src/schemas/`, new error codes in the closed `AppError` union. The direction filter joins the list's filter object in the URL search params, and so also drives bulk « select all ».

## UX & Interaction Patterns

- A matched transaction shows « Virement » and the other account's name on its row, as in Flow 2 of the experience document.
- The transaction sheet shows the linked transfer, with « Dissocier » to undo and « Ne plus proposer » to reject the pair.
- The filter bar gains the « sens » chip (income, expense, transfer), removable and kept in the URL like the other chips.
- A transaction with several candidates shows a suggestion to match by hand. Every visible string goes through `locales/fr.json`, errors appear as destructive Sonner toasts, and every action is reachable by keyboard.

## Cross-Story Dependencies

- Story 5.1 creates the tables, the ledger functions, `domain/transfer-matching.ts`, `domain/cash-flow.ts` and the direction filter. Story 5.2 plugs the same candidate search into step 6 of `ledger.ingest` and adds the suggestion and the reject path for automatic matches.
- Builds on Epic 1's ledger, sign convention and delete paths, Epic 2's `ingest` pipeline and import revert, and Epic 4's filter object and bulk delete.
- Epic 6 computes cash flow only through `countsInCashFlow` and `direction`. Epic 7 adds the loan and investment account types that produce `loan_payment` and `investment_contribution`. Epic 9 leaves transfers out of recurring detection. Epic 10's sync runs through the same `ingest`, so it inherits matching.

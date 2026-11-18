---
title: 'Hide the transactions of inactive accounts, as Sure does'
type: 'bugfix'
created: '2026-10-03'
status: 'done'
route: 'oneshot'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The transactions page, its count and totals, the assistant's `get_transactions` and `group_transactions_by_label`, bulk edits by filter, and rules applied to history all read the transactions of inactive accounts. On the owner's instance, three inactive BoursoBank `immediat_debit` card accounts copy every card payment of the checking account, so every card payment is listed twice. Sure hides them: `Entry.visible` keeps accounts whose status is `draft` or `active`, and `Transaction::Search` applies it before any account filter, so even an inactive account picked explicitly lists nothing (`active_accounts_only`, default true). Rules read `family.transactions.visible` too.

**Approach:** `filterCondition` keeps only rows of active accounts unless the filter asks for inactive ones; only an account's own page asks, as Sure's account page lists its own entries. `ruleCandidates` keeps only rows of active accounts. Bulk edits by ids, recurring detection and transfer matching are left as they are, as in Sure.

</frozen-after-approval>

## Implementation Notes

- `filterCondition` (`services/ledger/filter.ts`) adds `account_id in (select id from accounts where active = 1)` unless `includeInactiveAccounts` is set; `listAccountTransactions` sets it. Every reader of the filter follows: the list, its count and totals, `group_transactions_by_label`, `get_transactions`, bulk edits by filter, and `cashFlowByCategory`, which already passed only active accounts.
- `ruleCandidates` takes `{ activeAccountsOnly }`: `true` for applying rules to history, as Sure's `family.transactions.visible`; `false` for recurring detection, as Sure's identifier reads every account.
- Spec 1.6 kept a deactivated account's rows in `/operations` without a reason; the owner chose Sure's behaviour on 2026-10-03. `routes/accounts.spec.ts` now asserts the cross-account list hides them and the account's page keeps them.
- The totals' plan lost its covering index, since the new condition reads `account_id`: migration `0054` adds `account_id` to `entries_kind_currency_amount`. The volume project passes.
- `e2e/manage-accounts.spec.ts` asserted Spec 1.6's behaviour; it now checks the rows leave `/transactions`, stay on the account's page, and come back on reactivation. The full end-to-end run's two other failures were the `bank-connections.spec.ts` race already deferred from Story 16.2; both files pass on rerun.
- The MCP tool descriptions of `get_transactions`, `group_transactions_by_label` and `bulk_update_transactions` say deactivated accounts are left out.

## Review Triage Log

- Recurring detection lost an inactive account's rows through `ruleCandidates`: high, patched with `activeAccountsOnly`.
- `getCashFlow`'s docstring said its drill-down shows rows of accounts the report leaves out, now false for deactivated accounts: low, patched.
- MCP descriptions silent on deactivated accounts, an assistant naming one gets an empty page: medium, patched.
- `ingest` still applies rules to lines created on a deactivated account: low, deferred; only a file import or a manual entry reaches one, since syncs skip it.
- An inactive account kept in the filter chips by an old link now lists nothing: low, deferred; Sure does the same.
- Plan of `/api/transactions?account=<one>` not asserted with the new predicate: maybe-false, deferred; a volume case would settle it.
- No route or MCP test for the hidden rows: low, rejected; every reader goes through `filterCondition`, covered in `queries.spec.ts`.
- Raw `sql` in `filter.ts`: false; the file builds its `exists` on taggings the same way, and the `+` index hint needs `sql`.
- `docs/architecture.md` does not record the rule: low, rejected; Sure's behaviour is the default and needs no AD.
- Comment spacing and docstring wrapping: false after `pnpm format`.


# Reconcile transactions against statements

## Why

A household checking a manually managed account against a statement cannot tell which transactions it has already checked. Sure introduced a manual reconciliation workflow in [#2950](https://github.com/we-promise/sure/pull/2950).

## What changes

- Let an administrator enable manual reconciliation for the household.
- Show a transaction's reconciliation status, let an authorised editor change it individually or in bulk, and allow filtering by that status.

## Capabilities

### Modified capabilities

- `transactions`

## Impact

Transaction storage, list filters, bulk edits and household settings. File-based statement reconciliation and the statement vault are separate workflows.

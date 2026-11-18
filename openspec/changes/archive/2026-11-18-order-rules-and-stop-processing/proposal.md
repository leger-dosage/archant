# Order rules and stop processing

## Why

When two rules match a transaction, an administrator cannot choose their precedence or exempt the transaction from later rules. Sure added both controls in [#4013](https://github.com/we-promise/sure/pull/4013).

## What changes

- Let administrators reorder rules and choose whether a matching rule stops processing for that transaction.
- Apply ordered precedence to automatic and explicitly requested runs.
- Preserve the order and stop choice when moving an Archant archive between installations.

## Capabilities

### Modified capabilities

- `rules`

## Impact

Rule storage, execution, preview, settings and file exchange. The reorder controls share the rules editor with [rules on a phone](../import-files-and-edit-rules-on-a-phone/proposal.md).

## Why

A transaction entered or edited by hand waits for a separate rule run to be classified. Sure #4347 lets the household choose which rules take effect as part of that workflow.

## What Changes

- Add an opt-in switch to each rule, off for existing and new rules unless explicitly enabled.
- After a transaction is created or actually edited through the interface or assistant, run the enabled rules through the last opted-in rule on the affected transactions. Include bulk edits and categorisation.
- Identify these runs in the history and preserve the setting in household archives.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `rules`: Add immediate execution on transaction writes.

## Impact

Rule editor, rule storage and history, household export and restore, and shared transaction write services.

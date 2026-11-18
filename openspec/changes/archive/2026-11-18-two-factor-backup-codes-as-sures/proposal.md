# Two-factor backup codes as Sure's

## Why

Archant issues ten backup codes and has a separate regeneration action. Matching Sure gives members the same code format and replacement steps in both apps.

## What changes

- Issue eight single-use, 16-character hexadecimal backup codes when enabling two-factor authentication.
- Keep unused backup codes from previous enrolments valid after an upgrade.
- Replace codes by turning two-factor off with the current password and enrolling again.

## Capabilities

### New capabilities

### Modified capabilities

- `identity`

## Impact

Scope and acceptance criteria come from Story 36.5 in `docs/archive/bmad/planning-artifacts/epics.md`.

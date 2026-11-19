# A member who writes, and a guest as Sure's

## Why

A household can give a partner permission to update the ledger without giving them control of the server. A guest can read and manage their own sign-in.

## What changes

- Let administrators invite an administrator, member or guest. Upgrades SHALL preserve existing viewer accounts and invitations as guests. Guests SHALL have read-only access and writes SHALL respect the administrator-only exceptions.

## Capabilities

### New capabilities

### Modified capabilities

- `household-access`

## Impact

Scope and acceptance criteria come from Story 36.2 in `docs/archive/bmad/planning-artifacts/epics.md`.

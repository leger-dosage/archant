# Household preferences

## Why

Time zone, date format, country, budget month and currency are the household's settings, as Sure.

## What changes

- Store amounts as integer minor units with a currency code. Cross-account totals SHALL use the household's base currency and identify accounts excluded because their currency differs. Setup SHALL record the base currency and household preferences SHALL expose the supported settings.

## Capabilities

### New capabilities

### Modified capabilities

- `money-and-reporting`

## Impact

Scope and acceptance criteria come from Story 36.6 in `docs/archive/bmad/planning-artifacts/epics.md`.

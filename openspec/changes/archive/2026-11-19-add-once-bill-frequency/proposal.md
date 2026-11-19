## Why

A household can plan a registration fee or a bonus in Bills only by choosing a repeating schedule. [Sure #4975](https://github.com/we-promise/sure/pull/4975) adds a Once frequency for these dated payments.

## What Changes

- Let an administrator schedule and edit a bill or income that falls on a single date.
- Show that occurrence in Bills, Upcoming and eligible budget reservations. Keep overdue dates and payment history under the existing occurrence contracts.
- Accept the same frequency in the existing assistant tools for bills.

## Capabilities

### Modified Capabilities

- `recurring-payments`: Add a dated one-off frequency for bills and income.

## Impact

Bill forms, recurrence and occurrence services, the existing bill assistant tools and planning reads. The existing Sure archive shape holds the schedule without a migration.

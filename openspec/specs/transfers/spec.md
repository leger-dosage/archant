# transfers

## Purpose

Record internal transfers and confirm suggestions from the transfer matcher.

## Requirements

### Requirement: Manual transfers

Archant SHALL let an administrator link opposite transactions or create both sides of a transfer between accounts.

#### Scenario: Viewing a linked transfer

- **WHEN** a member opens either side of a transfer
- **THEN** the transfer shows both accounts and the paired amounts.

### Requirement: Suggested transfers

Archant SHALL suggest eligible matches without confirming them for the administrator.

#### Scenario: Confirming a match

- **WHEN** the administrator accepts a suggested pair
- **THEN** both entries represent a single internal transfer and leave income and expense totals.

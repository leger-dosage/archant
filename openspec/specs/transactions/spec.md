# transactions

## Purpose

Manual transactions, list filters, bulk edits, split lines and receipts.

## Requirements

### Requirement: Transaction list and editing

Archant SHALL let administrators record, update and delete transactions. Members SHALL be able to filter the household list by account, date, classification, status and amount.

#### Scenario: Viewing matching transactions

- **WHEN** a member filters by account and amount
- **THEN** only transactions matching both filters appear.

### Requirement: Bulk classification

Archant SHALL apply a bulk edit to the selected transactions.

#### Scenario: Changing categories in bulk

- **WHEN** an administrator assigns a category to selected transactions
- **THEN** each selected transaction receives that category and other transactions keep theirs.

### Requirement: Split transactions

Archant SHALL allow category and amount per split line and preserve the parent amount across edits.

#### Scenario: A split is saved

- **WHEN** an administrator replaces the split lines with new amounts that add up to the parent
- **THEN** the list shows the replacement lines and reports count their amounts only once.

### Requirement: Receipts

Archant SHALL let administrators attach receipts and let authorised members download them.

#### Scenario: Downloading an attachment

- **WHEN** a member opens a transaction with an attached receipt
- **THEN** they can retrieve the original file.

### Requirement: Manual reconciliation

Archant SHALL let an administrator enable manual reconciliation for the household. While enabled, members SHALL see and filter the reconciliation status of transactions in manually managed accounts they may read, and members with permission to edit the account SHALL be able to change it individually or in bulk.

#### Scenario: Enable reconciliation and check a statement

- **GIVEN** manual reconciliation is off by default and a manual account has existing transactions
- **WHEN** the administrator enables it
- **THEN** the transactions start as unreconciled. The administrator can cycle a transaction in the list or its detail from unreconciled to cleared, then reconciled, then unreconciled.

#### Scenario: Filter without changing bank status

- **WHEN** a member selects several reconciliation statuses and also filters by account or bank status
- **THEN** a transaction must match one selected reconciliation status and all other active filters. Changing the reconciliation status does not change the booked or pending status, a balance or a valuation.

#### Scenario: Mark several rows at once

- **GIVEN** a bulk selection contains both eligible transactions and rows from bank-linked accounts
- **WHEN** an administrator sets a reconciliation status for the selection
- **THEN** only the eligible selected transactions change. A read-only member cannot change any status.

#### Scenario: Pause reconciliation

- **WHEN** the administrator disables manual reconciliation
- **THEN** its controls and filter are unavailable, and previously recorded statuses return when the feature is enabled again.

#### Scenario: Restore an Archant archive

- **WHEN** an administrator imports an Archant archive into a new database
- **THEN** imported transactions and split lines keep their recorded reconciliation status. A transaction in an older archive without this field starts unreconciled.

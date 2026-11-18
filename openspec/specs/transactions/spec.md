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

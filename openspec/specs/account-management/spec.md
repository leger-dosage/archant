# account-management

## Purpose

Manage the household's account types, opening balances, snapshots and display preferences.

## Requirements

### Requirement: Account lifecycle

Archant SHALL let administrators create, edit, deactivate, reactivate and delete accounts, and distinguish assets from liabilities.

#### Scenario: An account is deactivated

- **WHEN** an administrator deactivates an account with ledger entries
- **THEN** the account leaves the active list and its entries remain in the ledger.

### Requirement: Opening balance and history

Archant SHALL derive daily balances from the opening position and the dated ledger. Administrators SHALL be able to confirm a dated balance snapshot.

#### Scenario: An administrator confirms a balance

- **WHEN** a snapshot is recorded for a day
- **THEN** history uses it as the balance for that day and computes subsequent balances from it.

### Requirement: Account preferences

Archant SHALL support a default account for new transactions and a saved account order.

#### Scenario: A default account is available

- **WHEN** an administrator opens a new transaction without an account in context
- **THEN** the form preselects the default account.

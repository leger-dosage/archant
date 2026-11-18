## ADDED Requirements

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

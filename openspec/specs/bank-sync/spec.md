# bank-sync

## Purpose

Enable Banking credentials, consent, read scheduling and ledger updates.

## Requirements

### Requirement: Bank setup and consent

Archant SHALL let administrators configure Enable Banking, choose a bank, consent at the bank and link selected accounts.

#### Scenario: Linking a bank account

- **WHEN** the bank returns its authorised accounts after consent
- **THEN** the administrator can link a returned account and choose the initial history start date.

### Requirement: Sync scheduling and progress

Archant SHALL sync active links on demand, at the configured daily time when enabled, and on the first signed-in visit of a day when no sync has started since midnight.

#### Scenario: Concurrent sync request

- **WHEN** an administrator requests a sync while one is running
- **THEN** Archant reports that a sync is in progress.

### Requirement: Bank balances and partial results

Archant SHALL apply successful bank reads independently of failed reads and keep the balance snapshots it records.

#### Scenario: An account read is incomplete

- **WHEN** the bank returns a successful read for one account and fails on another
- **THEN** the successful account's results are saved.

### Requirement: Pending and duplicate entries

Archant SHALL reconcile eligible pending and booked entries in place and let administrators resolve ambiguous duplicates.

#### Scenario: Booking a pending entry

- **WHEN** a booked entry matches an eligible pending entry
- **THEN** the ledger keeps a single entry with the booked data.

### Requirement: Renewal and disconnection

Archant SHALL warn before consent expires and let administrators renew, unlink one bank account or disconnect a bank without deleting ledger history.

#### Scenario: Disconnecting with missing credentials

- **WHEN** the administrator disconnects an existing connection whose connector credentials cannot be read
- **THEN** Archant disconnects it locally and retains its financial history.

## MODIFIED Requirements

### Requirement: Rule previews and runs

Archant SHALL let administrators confirm rule application to ledger history and inspect recorded rule runs. Archant SHALL run enabled rules over ledger history after a transaction import or a bank synchronisation that read at least one account. Previews and runs SHALL use the saved rule order and the same precedence rules.

#### Scenario: Reviewing a rule run

- **WHEN** an administrator confirms application of a rule to existing transactions
- **THEN** enabled rules above it run first, the selected rule runs at its place, and the run history shows the executed rules in order. Rules below it do not run.

#### Scenario: Running rules after a file import

- **WHEN** an administrator publishes a transaction import whose entries match an enabled rule
- **THEN** Archant applies enabled rules in their saved order to eligible transactions after the import finishes.

## ADDED Requirements

### Requirement: Rule order and per-transaction precedence

Archant SHALL let members who can edit rules set the execution order and choose whether an individual rule stops processing for each transaction it matches. The first matching rule to claim an attribute SHALL take precedence for that attribute within the run, including when the value already matches or a user lock prevents writing. Tags SHALL remain additive.

#### Scenario: Resolve overlapping rules

- **GIVEN** two enabled rules match the same transaction, each sets its category, and each adds a different tag
- **WHEN** the rules run
- **THEN** the category comes from the first rule and both tags are present. Changing the order changes which rule owns the category on the next run.

#### Scenario: Stop on one transaction

- **GIVEN** a rule stops processing and matches only one of two candidate transactions
- **WHEN** a later rule would match both
- **THEN** the later rule skips the stopped transaction and still considers the other transaction.

#### Scenario: Keep order through backup and restore

- **WHEN** an administrator exports the household and imports that archive into an empty Archant installation
- **THEN** the relative order and stop flags survive. Rules from an older archive have stop disabled and are ordered deterministically.

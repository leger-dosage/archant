# rules

## Purpose

Automate transaction edits with conditions and actions and inspect each run.

## Requirements

### Requirement: Rule conditions and actions

Archant SHALL combine configured conditions and apply the corresponding actions, including classifying, tagging, excluding or changing labels.

#### Scenario: Applying a label rule

- **WHEN** an administrator applies a rule with a label substitution to matching transactions
- **THEN** matching labels change according to the substitution.

### Requirement: Rule previews and runs

Archant SHALL let administrators confirm rule application to ledger history and inspect recorded rule runs. Archant SHALL run enabled rules over ledger history after a transaction import or a bank synchronisation that read at least one account. Previews and runs SHALL use the saved rule order and the same precedence rules.

#### Scenario: Reviewing a rule run

- **WHEN** an administrator confirms application of a rule to existing transactions
- **THEN** enabled rules above it run first, the selected rule runs at its place, and the run history shows the executed rules in order. Rules below it do not run.

#### Scenario: Running rules after a file import

- **WHEN** an administrator publishes a transaction import whose entries match an enabled rule
- **THEN** Archant applies enabled rules in their saved order to eligible transactions after the import finishes.

### Requirement: Use rules on narrow screens

Archant SHALL let administrators list and edit rules and read rule runs on narrow screens.

#### Scenario: List and edit rules

- **GIVEN** the same screen
- **WHEN** the administrator opens « Règles »
- **THEN** `_authed.rules.tsx` lists the rules and their runs, and « Ajouter une règle » opens the rule form, as Sure's `app/views/rules/*`; « Disponible sur ordinateur » goes.

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

### Requirement: Immediate rule execution

Archant SHALL let administrators opt in to immediate execution per rule. The option SHALL default to off for new and existing rules. After a transaction is created or its saved values change through manual entry, the application programming interface, the assistant, bulk edit or bulk categorisation, Archant SHALL evaluate only affected transactions, running enabled rules in saved order through the last enabled rule with immediate execution. Archant SHALL use existing lock, claim, tag and stop behavior. Matching turns SHALL appear as immediate runs. A rule failure SHALL preserve the triggering write. Saving or enabling the option SHALL have no retroactive effect. Rule writes, no-op edits and reconciliation bookkeeping alone SHALL NOT trigger immediate execution.

#### Scenario: Opt in to a rule

- **WHEN** an administrator saves a rule with immediate execution enabled and creates a matching transaction
- **THEN** the returned transaction reflects applicable actions and the history identifies the run as immediate.

#### Scenario: Use the ordered prefix

- **GIVEN** an enabled ordinary rule precedes an immediate rule and another ordinary rule follows it
- **WHEN** a transaction changes
- **THEN** the first rule can claim fields or stop the transaction before the immediate rule. The later ordinary rule waits for the next regular run.

#### Scenario: Apply a bulk edit only to changed transactions

- **WHEN** a bulk edit or categorisation changes one of two selected transactions and leaves the other's values the same
- **THEN** only the changed transaction is eligible for immediate execution.

#### Scenario: Save an open transaction after a rule changes it

- **GIVEN** saving a note runs an immediate rule while the transaction editor stays open
- **WHEN** the member later saves another field or changes the tag selection in that editor
- **THEN** untouched fields keep their saved values and the editor applies its tag additions and removals without discarding tags added by the rule.

#### Scenario: Keep the option through export and restore

- **WHEN** an administrator restores a household archive
- **THEN** the saved immediate setting is restored if present. Rules imported from older archives default to off.

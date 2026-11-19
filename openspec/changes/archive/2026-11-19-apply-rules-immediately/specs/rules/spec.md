## ADDED Requirements

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

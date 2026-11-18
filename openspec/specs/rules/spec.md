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

Archant SHALL let administrators confirm rule application to ledger history and inspect recorded rule runs. Archant SHALL run enabled rules over ledger history after a transaction import or a bank synchronisation that read at least one account.

#### Scenario: Reviewing a rule run

- **WHEN** an administrator confirms application of a rule to existing transactions
- **THEN** the matching changes take effect and the run appears in history.

#### Scenario: Running rules after a file import

- **WHEN** an administrator publishes a transaction import whose entries match an enabled rule
- **THEN** Archant applies the rule to eligible transactions after the import finishes.

# classification

## Purpose

Classify household transactions with categories, merchants and tags.

## Requirements

### Requirement: Categories

Archant SHALL support default and custom categories, parent and child categories, merge and deletion, and restoration of missing defaults.

#### Scenario: Restoring the default categories

- **WHEN** an administrator restores missing defaults
- **THEN** Archant creates missing defaults in the household's data language.

### Requirement: Merchants and tags

Archant SHALL let administrators manage merchants and tags and assign them to transactions.

#### Scenario: Creating a tag in context

- **WHEN** an administrator creates a tag in a transaction's tag picker
- **THEN** the new tag can be selected on that transaction.

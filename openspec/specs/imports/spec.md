# imports

## Purpose

Statement, spreadsheet and archive imports with preview and history.

## Requirements

### Requirement: Statement imports

Archant SHALL preview supported OFX, QIF and CSV statement data before publication and classify duplicates and rejected records.

#### Scenario: Importing a statement twice

- **WHEN** an administrator previews a statement whose transactions were already published
- **THEN** the preview identifies duplicates and publication creates no second copy of those transactions.

### Requirement: CSV mapping

Archant SHALL let an administrator map supported columns and save a mapping. It SHALL surface rejected rows before confirmation.

#### Scenario: Reusing a CSV layout

- **WHEN** the next file uses a previously saved layout
- **THEN** the administrator can reuse its mapping and inspect the preview.

### Requirement: Archive and entity imports

Archant SHALL accept supported Sure exports and CSV imports of accounts, categories, merchants, rules and trades.

#### Scenario: Previewing a Sure archive

- **WHEN** an administrator selects a compatible Sure export
- **THEN** they can inspect the import before writing it to the household.

### Requirement: Import history and revert

Archant SHALL record published imports and let administrators revert eligible batches without removing unrelated ledger changes.

#### Scenario: Reverting out of order

- **WHEN** an administrator reverts an earlier batch after publishing a later one
- **THEN** the ledger retains the later batch's independent changes.

### Requirement: Import statements on narrow screens

Archant SHALL let administrators complete the statement import on narrow screens.

#### Scenario: Import a statement

- **GIVEN** a screen narrower than 768 px
- **WHEN** the administrator opens « Importer un fichier »
- **THEN** `ImportDialog.tsx` shows its steps « Fichier », « Colonnes » and « Aperçu » rather than « Disponible sur ordinateur », as Sure's `app/views/imports/*`, which have no width gate; the column mapping and preview stack or scroll inside the dialog, and the administrator can confirm the import.

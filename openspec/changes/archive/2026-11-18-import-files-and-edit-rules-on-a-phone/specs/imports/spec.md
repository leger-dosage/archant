## ADDED Requirements

### Requirement: Import statements on narrow screens

Archant SHALL let administrators complete the statement import on narrow screens.

#### Scenario: Import a statement

- **GIVEN** a screen narrower than 768 px
- **WHEN** the administrator opens « Importer un fichier »
- **THEN** `ImportDialog.tsx` shows its steps « Fichier », « Colonnes » and « Aperçu » rather than « Disponible sur ordinateur », as Sure's `app/views/imports/*`, which have no width gate; the column mapping and preview stack or scroll inside the dialog, and the administrator can confirm the import.

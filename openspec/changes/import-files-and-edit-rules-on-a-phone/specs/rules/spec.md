## ADDED Requirements

### Requirement: Use rules on narrow screens

Archant SHALL let administrators list and edit rules and read rule runs on narrow screens.

#### Scenario: List and edit rules

- **GIVEN** the same screen
- **WHEN** the administrator opens « Règles »
- **THEN** `_authed.rules.tsx` lists the rules and their runs, and « Ajouter une règle » opens the rule form, as Sure's `app/views/rules/*`; « Disponible sur ordinateur » goes.

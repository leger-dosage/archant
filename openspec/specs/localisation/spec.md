# localisation

## Purpose

Member interface language and household data language.

## Requirements

### Requirement: Interface language

Archant SHALL display the interface in French or English according to the member preference, or the browser language for a new member.

#### Scenario: Changing the interface language

- **WHEN** a member selects English in preferences
- **THEN** the interface switches to English independently of the household's data language.

### Requirement: Household data language

Archant SHALL let administrators set the data language used for generated records, independently of member interface preferences.

#### Scenario: Changing the data language

- **WHEN** the administrator switches from French to English
- **THEN** future generated defaults, fallback labels and sample data use English and existing stored names remain as written.

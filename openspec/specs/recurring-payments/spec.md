# recurring-payments

## Purpose

Detected and manually scheduled bills and recurring income.

## Requirements

### Requirement: Detect and declare recurring series

Archant SHALL detect recurring payments from transaction history and let administrators declare and edit recurring series.

#### Scenario: Declaring a bill manually

- **WHEN** an administrator adds an active bill and configures its schedule
- **THEN** it appears in the list with the applicable due date.

### Requirement: Occurrences and payments

Archant SHALL show due and overdue occurrences and let administrators settle, reopen, skip, postpone or adjust individual occurrences.

#### Scenario: Settling an occurrence

- **WHEN** an administrator links an eligible payment
- **THEN** the occurrence reflects the applied amount and the same money cannot be counted twice.

### Requirement: Recurring feature preference

Archant SHALL let the household administrator disable recurring pages and automatic detection while retaining the series.

#### Scenario: Disabling recurring payments

- **WHEN** an administrator turns the feature off
- **THEN** automated import and sync runs do not detect series and saved series remain available on re-enable.

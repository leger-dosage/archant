# money-and-reporting

## Purpose

Monetary precision, reporting currency and ledger aggregation.

## Requirements

### Requirement: Amounts and reporting currency

Archant SHALL store amounts as integer minor units with a currency code. Cross-account totals SHALL use the household's base currency and identify accounts excluded because their currency differs. Setup SHALL record the base currency and household preferences SHALL expose the supported settings.

#### Scenario: Choose household settings at setup

- **GIVEN** `/setup`
- **WHEN** the first administrator is created
- **THEN** the page also asks « Pays », « Devise » and « Format de date ». The chosen country suggests a currency and the administrator can choose another before completing setup. Existing language selection still applies.

#### Scenario: Edit household preferences

- **GIVEN** « Réglages › Préférences »
- **WHEN** the administrator opens it
- **THEN** « Général » edits « Fuseau horaire », « Format de date » among Sure's `Family::DATE_FORMATS` and « Pays ». « Budget » saves « Le mois budgétaire commence le », 1 to 28. « Devise de base » shows the setup currency as read-only. The server refuses household preference writes by non-administrators. Personal preferences retain their own scope.

#### Scenario: Use stored settings after upgrade

- **GIVEN** the stored settings
- **WHEN** an existing instance upgrades
- **THEN** missing settings are seeded once from its existing `APP_TIMEZONE` value and the previous reporting currency, EUR. An already saved setting takes precedence.

#### Scenario: Apply saved preferences immediately

- **WHEN** an administrator changes the household time zone or date format
- **THEN** subsequent requests and scheduled runs use the saved time zone without a restart. Dates in the corresponding interface surfaces use the saved format. Stored dates and machine-readable dates in exchanges remain unchanged. The stored month start day takes effect in budgets when `start-the-month-on-the-households-chosen-day` ships.

#### Scenario: Reporting on an account in another currency

- **WHEN** a member loads household totals with an account whose currency differs from the household's base currency
- **THEN** the account retains its own currency and is reported as excluded from the totals.

### Requirement: Income and expense classification

Archant SHALL exclude internal transfers from income and expense totals and use split lines for their respective categories.

#### Scenario: Reporting on a split transaction

- **WHEN** a member runs a category report for a transaction with split lines
- **THEN** each eligible split contributes to its own category and the parent amount is not counted again.

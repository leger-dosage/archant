# money-and-reporting

## Purpose

Monetary precision, reporting currency and ledger aggregation.

## Requirements

### Requirement: Amounts and reporting currency

Archant SHALL store amounts as integer minor units with a currency code. Cross-account totals SHALL report in euros and identify accounts excluded because their currency differs.

#### Scenario: Reporting on an account in another currency

- **WHEN** a member loads household totals with a non-euro account
- **THEN** the account retains its own currency and is reported as excluded from the totals.

### Requirement: Income and expense classification

Archant SHALL exclude internal transfers from income and expense totals and use split lines for their respective categories.

#### Scenario: Reporting on a split transaction

- **WHEN** a member runs a category report for a transaction with split lines
- **THEN** each eligible split contributes to its own category and the parent amount is not counted again.

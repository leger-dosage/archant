# financial-data

## Purpose

Household export, financial reset and sample data.

## Requirements

### Requirement: Export archive

Archant SHALL let administrators download a ZIP of the household's financial data in Sure's export format, including attachment data and checksums.

#### Scenario: Exporting the household

- **WHEN** an administrator requests an export
- **THEN** the downloaded archive contains the financial records and the exported receipt files.

### Requirement: Financial data reset

Archant SHALL let administrators clear financial data after confirmation and optionally load a fictional household.

#### Scenario: Loading sample data

- **WHEN** an administrator confirms a reset with sample data
- **THEN** the old financial data is cleared and the sample household is seeded in the household's data language.

# reports

## Purpose

Balance sheet, cash flow and investment reporting, CSV and print.

## Requirements

### Requirement: Report sections

Archant SHALL display the household's balance sheet, cash flow and investment report sections for the selected reporting period.

#### Scenario: Opening reports with investment data

- **WHEN** a member opens the reports page for a period with holdings and investment activity
- **THEN** the investment sections present the available investment figures.

### Requirement: Report output

Archant SHALL provide report CSV output and a print layout. It SHALL retain the administrator's custom section layout in the interactive view.

#### Scenario: Printing a report

- **WHEN** a member opens a report's print layout
- **THEN** the page shows report content without the app shell.

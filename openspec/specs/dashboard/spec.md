# dashboard

## Purpose

Household net worth, balances, cash flow and investment widgets.

## Requirements

### Requirement: Net worth and cash flow

Archant SHALL display historical net worth, income and expenses, and account balances grouped by type.

#### Scenario: Choosing a dashboard period

- **WHEN** a member selects an available period
- **THEN** the dashboard redraws its period-dependent figures for the selected range.

### Requirement: Dashboard layout

Archant SHALL let the household administrator reorder, collapse or hide supported dashboard sections and restore the default layout.

#### Scenario: Reopening a rearranged dashboard

- **WHEN** the administrator returns to the dashboard after saving its layout
- **THEN** the saved order and visibility are used.

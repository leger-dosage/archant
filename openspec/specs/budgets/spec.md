# budgets

## Purpose

Monthly income and spending plans and category allocations.

## Requirements

### Requirement: Monthly budget

Archant SHALL plan a calendar month's expected income and spending, with actuals and historical suggestions.

#### Scenario: Opening a month with no budget

- **WHEN** a member opens an unset month
- **THEN** Archant shows actuals and suggestions without saving a budget.

### Requirement: Category allocation

Archant SHALL let an administrator allocate amounts to categories, including reserving a child's share of its parent allocation.

#### Scenario: Reducing a parent allocation

- **WHEN** the administrator sets a parent's amount below the sum of amounts reserved for its children
- **THEN** Archant refuses the change.

### Requirement: Copy, move and carry over

Archant SHALL support copying the latest earlier budget, moving budgeted money and applying carry-over.

#### Scenario: Copying after a gap

- **WHEN** an administrator copies a budget into an unset month after a month without a budget
- **THEN** Archant uses the latest earlier month that has a budget.

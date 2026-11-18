## MODIFIED Requirements

### Requirement: Reserves

Archant SHALL support reserves whose targets are fixed amounts or months of expenses, with expense-based targets stored and refreshed monthly.

#### Scenario: Creating an expense-based reserve

- **GIVEN** a reserve in months of expenses
- **WHEN** it is saved
- **THEN** `target_amount` stores the household's monthly expense median times its months, as Sure's `apply_months_of_expenses_target`, and every read uses the stored amount, where Archant computed it on each read.

#### Scenario: Refresh at the start of a month

- **GIVEN** a new month
- **WHEN** the first signed-in request of the month runs the day's work after it answers
- **THEN** each such reserve neither completed nor archived gets its target computed again, as Sure's `RefreshMaintainedGoalTargetsJob` on the 1st (`config/schedule.yml`); with no median, or a product of zero, the previous target stands, as `refresh_target_from_expenses!`.

#### Scenario: Bound the input by monetary precision

- **GIVEN** the form's « Mois de dépenses »
- **WHEN** the owner types a number
- **THEN** any positive whole number is accepted, the 120-month cap going, bounded only so the amount stays a safe integer, money being integer minor units; the hint reads « Recalculé le 1er de chaque mois à partir de vos dépenses mensuelles médianes. », Sure's `target_months_hint`.

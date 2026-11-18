# savings-goals

## Purpose

Account-backed savings goals and household reserves.

## Requirements

### Requirement: Savings goals

Archant SHALL track goal progress using the linked accounts and compute pace and projection from eligible ledger activity.

#### Scenario: Calculate pace from net inflow

- **GIVEN** a goal with linked accounts
- **WHEN** its pace is computed
- **THEN** each linked account with booked, non-excluded transactions in the last 90 days contributes its net inflow divided by three. Transfers between two linked accounts net to zero. Pace counts the whole accounts, including those with an earmark. The status compares the combined monthly pace with the amount needed each month.

#### Scenario: Measure an account tracked by balance updates

- **GIVEN** a linked account with no eligible transaction in the last 90 days, a balance recorded at least 365 days ago and a reconciliation or current-anchor valuation in the last year
- **WHEN** the goal's pace is calculated
- **THEN** the account contributes the change since that year-old balance divided by twelve, after removing excluded transaction flows. If contributions are the goal's progress basis, market movements over that year are also removed.

#### Scenario: Distinguish an unknown pace from zero

- **GIVEN** a dated, unreached goal with a linked account that lacks both eligible transaction evidence and a measurable balance history
- **WHEN** its pace and projection are shown
- **THEN** the goal shows an unknown pace and no projection line. An account with older eligible transactions and no valuation in the last year contributes a measured zero.

#### Scenario: Keep a deactivated linked account

- **GIVEN** a linked account deactivated after it was linked
- **WHEN** the goal is read
- **THEN** it keeps counting in the backing and the pace, as Sure's `linked_accounts` reads it whatever its status; « Compte désactivé, non compté » goes.

#### Scenario: Draw the history and projection

- **GIVEN** the « Projection » chart
- **WHEN** it draws
- **THEN** the saved line is the linked accounts' whole balance over 90 days scaled by today's ratio of the goal's backing to their total, capped at 1, as Sure's `Goal#projection_payload`, where Archant drew each day's share under today's links; when pace can be measured and the goal has a target date, the projection runs from today at that pace to the target date.

#### Scenario: Reviewing a funded goal

- **WHEN** a member opens a goal whose linked account balance has grown
- **THEN** the goal reflects the additional balance under its funding rules.

### Requirement: Reserves

Archant SHALL support reserves whose targets are fixed amounts or months of expenses, with expense-based targets stored and refreshed monthly.

#### Scenario: Creating an expense-based reserve

- **GIVEN** a reserve in months of expenses
- **WHEN** it is created, switched to that mode or saved with a different number of months
- **THEN** `target_amount` stores the household's monthly expense median times its months, as Sure's `apply_months_of_expenses_target`, and every read uses the stored amount. Editing another field leaves the target intact.

#### Scenario: Refresh at the start of a month

- **GIVEN** a new month
- **WHEN** the first signed-in request of the month runs the day's work after it answers
- **THEN** each such reserve neither completed nor archived gets its target computed again, as Sure's `RefreshMaintainedGoalTargetsJob` on the 1st (`config/schedule.yml`); with no median or a product outside the positive safe integer range, the previous target stands, as `refresh_target_from_expenses!`.
- **AND** the first response reads the previous target. The refresh runs independently and commits at most once per calendar month, including when signed-in requests arrive together or the first visit is after the first day of the month.

#### Scenario: Bound the input by monetary precision

- **GIVEN** the form's « Mois de dépenses »
- **WHEN** the owner types a number
- **THEN** any positive whole number is accepted, the 120-month cap going, bounded only so the amount stays a safe integer, money being integer minor units; the hint reads « Recalculé le 1er de chaque mois à partir de vos dépenses mensuelles médianes. », Sure's `target_months_hint`.

#### Scenario: Combined targets exceed the representable amount

- **GIVEN** the sum of stored targets exceeds the safe integer range
- **WHEN** a member reads the dashboard
- **THEN** the dashboard still shows the individual targets and indicates that their combined target is too large to display.

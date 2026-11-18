## MODIFIED Requirements

### Requirement: Savings goals

Archant SHALL track goal progress using the linked accounts and compute pace and projection from eligible ledger activity.

#### Scenario: Calculate pace from net inflow

- **GIVEN** a goal with linked accounts
- **WHEN** its pace is computed
- **THEN** it is the net inflow of booked, non-excluded transactions on its linked accounts over the last 90 days divided by three, as Sure's `Goal.pace_for` and `#pace`, the whole accounts even for an earmarked goal; a snapshot moves no pace, where Archant took the balance change; its status compares it with the monthly amount needed, as `Goal#status`.

#### Scenario: Keep a deactivated linked account

- **GIVEN** a linked account deactivated after it was linked
- **WHEN** the goal is read
- **THEN** it keeps counting in the backing and the pace, as Sure's `linked_accounts` reads it whatever its status; « Compte désactivé, non compté » goes.

#### Scenario: Draw the history and projection

- **GIVEN** the « Projection » chart
- **WHEN** it draws
- **THEN** the saved line is the linked accounts' whole balance over 90 days scaled by today's ratio of the goal's backing to their total, capped at 1, as Sure's `Goal#projection_payload`, where Archant drew each day's share under today's links; the projection runs from today at the pace to the target date, as `projection_end_amount`.

#### Scenario: Reviewing a funded goal

- **WHEN** a member opens a goal whose linked account balance has grown from an eligible deposit
- **THEN** the goal reflects the deposit under its funding rules.

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

Archant SHALL support reserves and estimating their targets from a number of months of household expenses.

#### Scenario: Creating an expense-based reserve

- **WHEN** an administrator selects a number of months of expenses for a reserve
- **THEN** Archant supplies a target based on household spending history.

### Requirement: Spend a goal

Archant SHALL record goal spending or match it to an eligible outflow and count consumed money toward progress.

#### Scenario: Record spending

- **GIVEN** an active one-off goal backed by money
- **WHEN** the owner chooses « J'ai utilisé une partie de cet argent »
- **THEN** « Enregistrer une dépense » asks « Combien avez-vous utilisé ? » and, with several links, « Depuis quel compte ? », then records it as Sure's `Goal#consume!`: `consumed_amount` grows, a fixed earmark shrinks by the amount, a whole-balance link becomes the smaller of what it backs and what the goal still needs.

#### Scenario: Refuse ineligible spending

- **GIVEN** a spend Sure refuses
- **WHEN** it is submitted
- **THEN** it answers Sure's `ConsumptionRefused` reason with Sure's text, such as « C'est plus que ce que cet objectif visait à épargner. »; a reserve, or a goal no longer active, records nothing.

#### Scenario: Claim an outflow

- **GIVEN** booked, non-excluded outflows of at least 100 € on an active one-off goal's accounts in the last 90 days
- **WHEN** the goal page shows
- **THEN** the three newest unclaimed ones are listed under « De l'argent est sorti de ces comptes », each with « C'était ça », which records it as spent and stamps it, as Sure's `Goal::WithdrawalDetector`.

#### Scenario: Include consumed money in progress

- **GIVEN** a goal with money spent
- **WHEN** its card and ring show
- **THEN** progress counts what was spent as found, `remaining_amount` and `progress_percent` adding `consumed_amount`, and both read « Dont %{amount} déjà utilisés », as Sure's.

#### Scenario: Concurrent or refused claims

- **WHEN** two requests claim the same outflow, or a claim fails a goal spending check
- **THEN** only one successful claim may update the goal and its allocation
- **AND** a refused request changes neither the allocation, the consumed amount nor the outflow stamp.

#### Scenario: Restore a goal

- **WHEN** an administrator reopens a completed goal or restores an archived one
- **THEN** the new lifecycle of a previously completed goal starts with no consumed amount, and a goal archived without completing keeps its consumed amount
- **AND** previously claimed outflows remain claimed.

### Requirement: Filter, search and summarise goals

Archant SHALL filter and search goals and show contribution and progress indicators.

#### Scenario: Filter by status

- **GIVEN** `/goals`
- **WHEN** it renders
- **THEN** chips filter the grid of active and completed goals, as Sure's `goals/index.html.erb`: « Tous », then « En retard », « En bonne voie », the open-ended status, « En pause » and « Terminé », each worded as Archant's cards word that status; « Archivés » stays apart and unfiltered; an empty result reads « Aucun objectif ne correspond à ce filtre. ».

#### Scenario: Search by name

- **GIVEN** more than six goals in the grid
- **WHEN** the owner types in « Rechercher des objectifs… »
- **THEN** goals filter by name, the chips still applying, and an empty result reads Sure's `goals.index.search` text, « Aucun objectif ne correspond à "%{query}". » among them.

#### Scenario: Read the goal indicators

- **GIVEN** the indicator strip
- **WHEN** it renders
- **THEN** it shows « Contribué · 30 derniers jours », the net inflow into goal-linked accounts with « ↑ N % vs 30 jours précédents » or its down and flat forms; « Requis ce mois-ci », the monthly amounts of the goals behind their pace, with « N objectifs en retard »; « Objectifs en bonne voie » as « %{on_track} sur %{total} », paused goals, reserves, reached goals, open-ended goals and goals with unknown pace out of the total. The indicator reports the number of active goals with unknown pace separately.

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

### Requirement: Explain a goal's state on its page

Archant SHALL explain a goal's state and projection and show the relevant actions.

#### Scenario: Read the goal status

- **GIVEN** an active goal's page
- **WHEN** it renders
- **THEN** the header reads « Objectif : %{amount} d'ici le %{date} » with « N jours restants », « Objectif : %{amount} · attendu le %{date} » once the date has passed, or « Cible : %{amount} »; then one status line, Sure's `Goal#status_callout_context`: « atteindra l'objectif vers %{date} », « épargnez %{amount}/mois de plus pour rattraper le retard », « définissez une date cible pour projeter une date de fin », the unknown-pace guidance, or the depleted reserve's line.

#### Scenario: See the action for the current state

- **GIVEN** the state panel
- **WHEN** the goal is behind, reached but not closed, a reserve whole or short, or without a date
- **THEN** it shows Sure's `Goals::LifecyclePanelComponent` card: « Épargnez %{amount}/mois de plus pour rattraper le retard » with « Ajuster l'objectif à la place »; « Vous avez atteint votre cible, à %{saved} sur %{target}. » with « Clôturer cet objectif »; « Réserve constituée »; « Réserve sous son solde cible »; « Ajouter une date cible » with « Définir la date cible ».

#### Scenario: Read the projection summary

- **GIVEN** the « Projection » chart
- **WHEN** its subtitle renders
- **THEN** it reads Sure's `Goal#projection_summary`, « Au rythme actuel, vous atteindrez cet objectif vers le %{date}. », « Insuffisant au rythme actuel. » or the sentence for no date, zero measured pace, unknown pace, a reserve or a reached goal. Unknown pace explains what account history is needed instead of showing a shortfall.

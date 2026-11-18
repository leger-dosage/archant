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

### Requirement: Pledge a deposit toward a goal

Archant SHALL accept a deposit pledge against a goal and reconcile it to an eligible deposit.

#### Scenario: Record a pledge

- **GIVEN** an active goal
- **WHEN** the owner chooses « Enregistrer un virement effectué », shown when a linked account is bank-linked or an investment account, or « Enregistrer l'argent mis de côté » otherwise, as Sure's `pledge_action_label_key`
- **THEN** a form takes « Montant » and « Sur le compte », previews « Atteindra {percent}%, {newTotal} sur {target}. », and « Enregistrer la promesse » records an open pledge expiring in 7 days, as Sure's `GoalPledge`; an identical open pledge is refused, as `no_duplicate_open_pledge`. When a transaction has matched, the goal header shows when the latest matched deposit was booked.

#### Scenario: Match a deposit once

- **GIVEN** an open pledge
- **WHEN** a synced inflow, a newly booked transfer or cash deposit into its account, or a snapshot raising a manual cash account falls between 5 days before the pledge and its expiry, within 0.50 currency units or 1% of its amount
- **THEN** the oldest eligible pledge is matched once after the deposit commits. The same deposit cannot satisfy another pledge.

#### Scenario: Pair two existing entries

- **GIVEN** the inflow and outflow are already booked
- **WHEN** the owner matches them manually or a transfer rule pairs them
- **THEN** the pairing leaves pledge status unchanged. The deposit is reconciled when it is booked.

#### Scenario: Leave a pledge open after an ineligible movement

- **GIVEN** an open pledge on an investment account
- **WHEN** an investment snapshot raises the balance, securities are bought or moved, or an outflow is booked
- **THEN** the pledge remains open.

#### Scenario: Extend or cancel a pledge

- **GIVEN** the goal page
- **WHEN** a pledge is open
- **THEN** it reads « En attente : %{amount} vers %{account} · N jours restants » with « Prolonger de 7 jours » and « Annuler »; a pledge past its expiry reads expired and matches nothing, as Sure's `SweepExpiredGoalPledgesJob`.

#### Scenario: Apply pending pledges to catch-up

- **GIVEN** a goal behind its pace
- **WHEN** pledges are open
- **THEN** the catch-up amount subtracts them, as `Goal#catch_up_delta_money`, reading « les promesses en attente comblent le retard » once covered; cards show « Promesse en attente ».

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

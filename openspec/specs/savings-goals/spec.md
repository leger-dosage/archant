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

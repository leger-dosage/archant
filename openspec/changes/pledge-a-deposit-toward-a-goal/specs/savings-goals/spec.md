## ADDED Requirements

### Requirement: Pledge a deposit toward a goal

Archant SHALL accept a deposit pledge against a goal and reconcile it to an eligible deposit.

#### Scenario: Record a pledge

- **GIVEN** an active goal
- **WHEN** the owner chooses « Enregistrer un virement effectué », shown when a linked account is bank-linked or an investment account, or « Enregistrer l'argent mis de côté » otherwise, as Sure's `pledge_action_label_key`
- **THEN** a form takes « Montant » and « Sur le compte », previews « Atteindra {percent}%, {newTotal} sur {target}. », and « Enregistrer la promesse » records an open pledge expiring in 7 days, as Sure's `GoalPledge`; an identical open pledge is refused, as `no_duplicate_open_pledge`.

#### Scenario: Match a deposit once

- **GIVEN** an open pledge
- **WHEN** a synced inflow on its account, or a snapshot raising a manual cash account, falls between 5 days before the pledge and its expiry, within 0,50 € or 1 % of its amount
- **THEN** the oldest matching pledge is matched and the transaction stamped once, as Sure's `GoalPledge::Reconciler` and `#matches?`.

#### Scenario: Extend or cancel a pledge

- **GIVEN** the goal page
- **WHEN** a pledge is open
- **THEN** it reads « En attente : %{amount} vers %{account} · N jours restants » with « Prolonger de 7 jours » and « Annuler »; a pledge past its expiry reads expired and matches nothing, as Sure's `SweepExpiredGoalPledgesJob`.

#### Scenario: Apply pending pledges to catch-up

- **GIVEN** a goal behind its pace
- **WHEN** pledges are open
- **THEN** the catch-up amount subtracts them, as `Goal#catch_up_delta_money`, reading « les promesses en attente comblent le retard » once covered; cards show « Promesse en attente ».

## ADDED Requirements

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

## ADDED Requirements

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

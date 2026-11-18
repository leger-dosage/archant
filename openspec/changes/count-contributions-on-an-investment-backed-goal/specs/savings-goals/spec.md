## ADDED Requirements

### Requirement: Count contributions on an investment-backed goal

Archant SHALL track investment-backed goal progress by contributions and show its market value separately.

#### Scenario: Choose a progress basis

- **GIVEN** a goal linking an investment account
- **WHEN** it is saved
- **THEN** its progress basis becomes contributions, as Sure's `default_progress_basis_for_investment`; a goal on current and savings accounts alone keeps the balance basis.

#### Scenario: Exclude market movements

- **GIVEN** a goal on the contributions basis
- **WHEN** its backing is computed
- **THEN** each investment account counts its balance less its cumulative market gain, floored at zero, as Sure's `net_contributed_for` over `balances.net_market_flows`; a current or savings account counts its balance; the earmark and remainder split stays `backing_share_for`'s.

#### Scenario: Show market value

- **GIVEN** the goal page of such a goal
- **WHEN** the ring shows
- **THEN** it adds « Valeur de marché %{amount} », the backing on the balance basis, as Sure's `goals.show.ring.market_value` and `Goal#market_value_money`.

#### Scenario: Leave pledges unmatched

- **GIVEN** a pledge on such a goal
- **WHEN** a snapshot raises the investment account
- **THEN** it matches no pledge, since a market move is no deposit, as Sure's `GoalPledge#matches?`.

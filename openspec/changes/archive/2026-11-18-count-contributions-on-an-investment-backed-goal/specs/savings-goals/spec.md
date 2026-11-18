## ADDED Requirements

### Requirement: Count contributions on an investment-backed goal

Archant SHALL let an administrator choose between current market value and net contributions, default to current market value and show it separately for an investment-backed goal that counts contributions.

#### Scenario: Choose a progress basis

- **GIVEN** a new goal or an existing goal without a saved basis
- **WHEN** the administrator has not chosen a basis
- **THEN** the goal counts the current value of its linked accounts.

#### Scenario: Keep the selected progress basis

- **GIVEN** a goal set to count contributions
- **WHEN** the administrator edits the goal or changes its linked accounts without changing the basis
- **THEN** the goal still counts contributions and the page names its basis.

#### Scenario: Keep the basis of a completed goal

- **GIVEN** a goal with a frozen completion amount, including one archived after completion
- **WHEN** the administrator tries to change the progress basis
- **THEN** Archant refuses the change and preserves the frozen amount. Reopening the goal makes the choice editable again.

#### Scenario: Exclude market movements

- **GIVEN** a goal on the contributions basis
- **WHEN** its backing is computed
- **THEN** each investment account counts its balance less its cumulative market gain, floored at zero, as Sure's `net_contributed_for` over `balances.net_market_flows`; a current or savings account counts its balance; the earmark and remainder split stays `backing_share_for`'s.

#### Scenario: Show market value

- **GIVEN** the goal page of such a goal
- **WHEN** the ring shows
- **THEN** it adds « Valeur de marché %{amount} », the backing on the balance basis, as Sure's `goals.show.ring.market_value` and `Goal#market_value_money`.

## MODIFIED Requirements

### Requirement: Monthly budget

Archant SHALL calculate budget periods from the household's first day of the month, with actuals, carry-over and suggestions based on those periods. Opening an unset period SHALL generate its view without saving a budget.

#### Scenario: Start on the twenty-fifth

- **GIVEN** `month_start_day` set to 25 in the household preferences of Story 36.6
- **WHEN** the owner opens « Budgets » on 3 February 2027
- **THEN** the current budget runs from 25 January to 24 February 2027, as Sure's `Family#custom_month_start_for` and `custom_month_end_for`; its actuals, its carry and its suggestions read that period; its name reads « 25 janv. - 24 février 2027 », Sure's `budgets.name.custom_range` with the short and long date formats.

#### Scenario: Keep calendar months when the start day is one

- **GIVEN** `month_start_day` at 1
- **WHEN** any budget is read
- **THEN** it covers the calendar month, as Sure's `uses_custom_month_start?` false, and nothing changes from today.

#### Scenario: Resolve a month slug

- **GIVEN** the URL `/budgets/2027-02` or `get_budget` and `update_budget` with `month: "2027-02"`
- **WHEN** the month is resolved
- **THEN** it names the period starting on 25 February 2027, as Sure's `Budget.param_to_date` and `MonthResolvable#resolve_month_start`; the arrows step one period; the bounds run from two years before the current period, or the oldest entry's, to two years after it, as `budget_date_valid?` and `latest_valid_budget_start_date`.

#### Scenario: Opening a month with no budget

- **WHEN** a member opens an unset budget period
- **THEN** Archant shows actuals and suggestions without saving a budget.

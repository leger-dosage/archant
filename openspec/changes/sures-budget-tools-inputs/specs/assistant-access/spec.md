## ADDED Requirements

### Requirement: Sure's budget tools' inputs

Archant SHALL allow get_budget and update_budget to use the same inputs, ordering and refusal keys as the supported Sure tools.

#### Scenario: Start a budget with a partial update

- **GIVEN** `update_budget` with only `categories`, or only `expected_income`, for a month never set up
- **WHEN** it runs
- **THEN** it sets up the month and saves what it got, as Sure's `Budget.find_or_bootstrap` on any update; Archant no longer requires spending and income together.

#### Scenario: Apply repeated categories in order

- **GIVEN** `categories` naming one category twice
- **WHEN** it runs
- **THEN** both entries apply, subcategories first and parents last, in the order given, the last amount of each winning, as Sure's `UpdateBudget#call`; nothing is refused for the repeat.

#### Scenario: Reject invalid updates

- **GIVEN** an input Sure refuses
- **WHEN** it runs
- **THEN** it answers Sure's keys in Sure's order: `no_changes` without a field, `invalid_month` out of bounds, `invalid_params` for a bad month slug, a negative amount, an unknown category or « Non classé » with Sure's messages, and `validation_failed` only for a refusal of the saved row; an amount with more decimals than the currency holds stays refused, money being integer minor units, as `invalid_params`.

#### Scenario: Read prior months without writing

- **GIVEN** `get_budget` with `prior_months`
- **WHEN** an earlier month in bounds has no budget set up
- **THEN** it is left out of `months` and counted in `months_unavailable`, as Sure lists only the months whose budget exists; a month out of bounds is counted nowhere; a target month out of bounds answers `{ currency, months: [] }` instead of `not_found`; the target month is always listed, computed without a write.

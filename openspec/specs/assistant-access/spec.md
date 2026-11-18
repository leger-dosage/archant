# assistant-access

## Purpose

Authorise connections to household tools over the Model Context Protocol.

## Requirements

### Requirement: Authorising an assistant

Archant SHALL let administrators authorise an assistant connection, inspect its access and revoke it.

#### Scenario: An assistant's access is revoked

- **WHEN** the formerly authorised assistant attempts to call a tool
- **THEN** the server refuses the connection's access.

### Requirement: Read and write tools

Archant SHALL allow an authorised assistant to read household finances. Write tools SHALL require write access granted by the administrator.

#### Scenario: Using a read-only connection

- **WHEN** a connected assistant attempts to record a transaction
- **THEN** the server refuses the write and the ledger remains unchanged.

### Requirement: Sure's budget tools' inputs

Archant SHALL allow get_budget and update_budget to use the same inputs, ordering and refusal keys as the supported Sure tools.

#### Scenario: Start a budget with a partial update

- **GIVEN** `update_budget` with only `categories`, `expected_income` or `budgeted_spending` for a month without a stored budget
- **WHEN** it runs
- **THEN** it saves the provided fields and creates a budget record if needed. A missing planned spending amount stays unset, and setting planned spending defaults still-unset expected income to zero. A refused update leaves the month unchanged, including when it had no record.

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
- **WHEN** an earlier month in bounds has no stored budget
- **THEN** it is left out of `months` and counted in `months_unavailable`. A prior month with a stored budget record is included even if the record has no planned spending. An out-of-bounds month is neither listed nor counted, including when it is the target. The response can still list earlier months within bounds. The target is computed without a write when it is within bounds and has no record.

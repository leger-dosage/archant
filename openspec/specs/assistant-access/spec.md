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

### Requirement: Sure's `create_goal` contract

Archant SHALL accept the supported Sure create_goal inputs and match active depository accounts by name.

#### Scenario: Accept the supported goal arguments

- **GIVEN** `create_goal`
- **WHEN** an assistant calls it
- **THEN** it takes Sure's parameters alone, `name`, `target_amount`, `target_date`, `linked_account_names`, `earmarks` and `notes`, and creates a one-off goal, as Sure's `CreateGoal`; `kind` and `target_months` go, and the refusal of a reserve's date with them.

#### Scenario: Match active depository accounts

- **GIVEN** `linked_account_names`
- **WHEN** the names are matched
- **THEN** they are matched among the active current and savings accounts, Sure's visible `Depository` accounts; an investment account's name answers `unknown_accounts` with `available_accounts`.

#### Scenario: Return available account details

- **GIVEN** `available_accounts` in a refusal
- **WHEN** it lists an account
- **THEN** it gives `name`, `currency`, `free_to_earmark` and `claimed_in_full`, `free_to_earmark` being the balance less the fixed earmarks of goals neither completed nor archived, as Sure's `Account#free_to_earmark`, so an account claimed in full no longer reads `0,00 €`.

#### Scenario: Preserve get_goals

- **GIVEN** `get_goals`
- **WHEN** this story ships
- **THEN** it stays as it is, an Archant addition Sure lacks (owner's decision of 2026-10-14); AD-19 changes with this story, `fundableAccountsNamed` matching depository accounts.

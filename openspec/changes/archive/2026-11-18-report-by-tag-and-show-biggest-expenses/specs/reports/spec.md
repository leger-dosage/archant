## ADDED Requirements

### Requirement: Reports filtered by tag

Archant SHALL let members select one or more tags to filter transaction-based report figures and output. The selection SHALL remain active across period changes, print, transaction CSV download and drill-down links.

#### Scenario: Follow a tagged project

- **GIVEN** one transaction has both selected tags and another has only one
- **WHEN** the member views reports with both tags selected
- **THEN** both transactions contribute once to the summary, trends and breakdown. Trades do not contribute to those filtered figures. The previous-period comparison uses the same selection.

#### Scenario: Print or open a breakdown

- **WHEN** the member prints, exports report transactions or opens a category drill-down
- **THEN** the output retains the tag selection, and a drill-down combines the tags with the target category. Net worth, investment sections and overall budget performance retain their household scope.

### Requirement: Biggest expenses

Archant SHALL rank eligible expenses by amount in the selected period, with the current tag selection, in the interactive report and print. The interactive section SHALL support the existing report layout controls.

#### Scenario: See the largest eligible outflows

- **GIVEN** the period contains ordinary expenses, a one-time expense, income, transfers and excluded transactions
- **WHEN** the member opens the section
- **THEN** the list shows up to ten expenses by default, largest first, including and identifying the one-time expense. Income, trades, internal transfers, card payments and excluded transactions are omitted. Eligible loan payments and investment contributions count as expenses regardless of how their sign was stored.

#### Scenario: Select a limit

- **WHEN** the administrator saves a limit of 5, 10 or 25
- **THEN** the interactive and printed reports use that limit after reload. A period without eligible expenses omits the section.

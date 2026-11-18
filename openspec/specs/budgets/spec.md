# budgets

## Purpose

Monthly income and spending plans and category allocations.

## Requirements

### Requirement: Monthly budget

Archant SHALL plan a calendar month's expected income and spending, with actuals and historical suggestions.

#### Scenario: Opening a month with no budget

- **WHEN** a member opens an unset month
- **THEN** Archant shows actuals and suggestions without saving a budget.

### Requirement: Category allocation

Archant SHALL let an administrator allocate amounts to categories, including reserving a child's share of its parent allocation.

#### Scenario: Reducing a parent allocation

- **WHEN** the administrator sets a parent's amount below the sum of amounts reserved for its children
- **THEN** Archant refuses the change.

### Requirement: Copy, move and carry over

Archant SHALL support copying the latest earlier budget, moving budgeted money and applying carry-over.

#### Scenario: Copying after a gap

- **WHEN** an administrator copies a budget into an unset month after a month without a budget
- **THEN** Archant uses the latest earlier month that has a budget.

### Requirement: Available cash beside the budget

Archant SHALL show available, earmarked and free cash beside the budget.

#### Scenario: Open the cash summary

- **GIVEN** the budget page of any month
- **WHEN** it renders
- **THEN** a « Trésorerie disponible » panel, subtitled « À côté du plan ci-dessus, pas dedans. », sits between the summary and the categories, as Sure's `budgets/show.html.erb:53`, with « Disponible en cash », « Déjà fléché vers des objectifs » preceded by « − », « Réellement libre » in large type, and a « Voir les objectifs » link to `/goals`.

#### Scenario: Calculate free cash

- **GIVEN** the three figures
- **WHEN** they are computed
- **THEN** « Disponible en cash » sums today's balances of the active current and savings accounts included in reports, Sure's `Budget#cash_accounts` on `Depository`, an investment account's cash left out; « Déjà fléché vers des objectifs » sums the backing within those accounts of every goal neither completed nor archived, a whole-balance link counting the remainder it claims, as `earmarked_for_goals` through `Goal#backing_within`; « Réellement libre » is the difference floored at zero, as `free_cash`.

#### Scenario: Skip a foreign-currency account

- **GIVEN** an account in another currency than the reporting one
- **WHEN** the panel sums
- **THEN** it counts in none of the three, as every Archant total until exchange rates exist (AD-6).

#### Scenario: Keep budget totals independent

- **GIVEN** the budget's own figures
- **WHEN** the panel shows
- **THEN** no budget figure changes, as Sure keeps the panel outside the allocation arithmetic; it shows without Sure's preview flag, as goals do.

### Requirement: Bills reserved inside each envelope

Archant SHALL show outstanding qualifying bill payments on the corresponding budget envelope without changing its totals.

#### Scenario: Reserve unpaid bill amounts

- **GIVEN** an active bill with a category, not a recurring transfer, with an open occurrence due within the budget's period
- **WHEN** the budget page shows its category
- **THEN** the envelope reads « %{amount} réservés par des factures », the sum of what each such occurrence still expects after its confirmed payments, as Sure's `BudgetCategory#bills_reserved` and `_budget_category.html.erb:82`.

#### Scenario: Skip ineligible occurrences

- **GIVEN** a paused bill, a recurring transfer, an income bill, an occurrence paid in full or one due outside the period
- **WHEN** the reservation sums
- **THEN** it reserves nothing, as Sure's `bills_reservation` takes active series with `destination_account_id` empty and a positive amount, due in the period; a reservation of zero shows no line.

#### Scenario: Explain omitted foreign-currency bills

- **GIVEN** a bill in another currency than the budget
- **WHEN** the reservation sums
- **THEN** it is left out and counted, the envelope reading « 1 facture n'est pas réservée, aucun taux de change disponible », Sure's `bills_reserved_unconvertible`, since Archant holds no exchange rate (AD-6).

#### Scenario: Keep envelope totals independent

- **GIVEN** the envelope's figures
- **WHEN** a reservation shows
- **THEN** its budgeted, spent and available amounts are unchanged, as Sure's read-side hook.

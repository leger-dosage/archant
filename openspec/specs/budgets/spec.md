# budgets

## Purpose

Monthly income and spending plans and category allocations.

## Requirements

### Requirement: Monthly budget

Archant SHALL calculate budget periods from the household's first day of the month, with actuals, carry-over and suggestions based on those periods. Opening an unset period SHALL generate its view without saving a budget.

#### Scenario: Start on the twenty-fifth

- **GIVEN** `month_start_day` set to 25 in the household preferences of Story 36.6
- **WHEN** the owner opens « Budgets » on 3 February 2027
- **THEN** the current budget runs from 25 January to 24 February 2027, as Sure's `Family#custom_month_start_for` and `custom_month_end_for`; its actuals, its carry and its suggestions read that period; its name reads « 25 janv. - 24 février 2027 », Sure's `budgets.name.custom_range` with the short and long date formats.

#### Scenario: Keep calendar months when the start day is one

- **GIVEN** `month_start_day` at 1
- **WHEN** an unset budget is read or saved
- **THEN** its dates cover the calendar month.

#### Scenario: Resolve a month slug

- **GIVEN** a start day of 25, no saved February budget, and the URL `/budgets/2027-02` or `get_budget` and `update_budget` with `month: "2027-02"`
- **WHEN** the month is resolved
- **THEN** it names the period starting on 25 February 2027, as Sure's `Budget.param_to_date` and `MonthResolvable#resolve_month_start`; the arrows step one period; the bounds run from two years before the current period, or the oldest entry's, to two years after it, as `budget_date_valid?` and `latest_valid_budget_start_date`.

#### Scenario: Keep a saved budget's dates

- **GIVEN** a budget with saved dates, including calendar dates set by the upgrade
- **WHEN** the household changes its start day and opens the budget by its slug
- **THEN** the saved dates and allocations still apply, even if the slug falls outside the bounds for new budgets. An unset month uses the new start day.

#### Scenario: Opening a month with no budget

- **WHEN** a member opens an unset budget period
- **THEN** Archant shows actuals and suggestions without saving a budget.

### Requirement: Category allocation

Archant SHALL give every category an envelope, copy stored allocations and carry choices, and apply the reserve rules when updating or moving an allocation.

#### Scenario: Show every category

- **WHEN** a month is set up, copied or shown
- **THEN** every category continues to have an envelope, regardless of past income or expense use.

#### Scenario: Copy category allocations

- **GIVEN** a previous budget with saved category amounts and carry choices
- **WHEN** the administrator copies it into an unset month
- **THEN** Archant uses the latest earlier budget that is set up and copies each stored amount and carry choice. A subcategory re-parented since that budget does not increase its new parent's copied amount.

#### Scenario: Show the saved subcategory amount

- **GIVEN** a subcategory on « Modifiez vos budgets de catégorie »
- **WHEN** its field shows
- **THEN** it shows the stored amount, a saved 0 included, and « Partagé » is only the placeholder of an empty field, as Sure's `_budget_category_form.html.erb`.

#### Scenario: Reducing a parent allocation

- **GIVEN** a parent saved below the sum of its ring-fenced subcategories
- **WHEN** the save lands
- **THEN** the parent keeps the amount typed until the next subcategory save rebuilds it from its subcategories and its reserve, as Sure's `sync_parent_budgeted_spending!`.

#### Scenario: Move money within the available allocation

- **GIVEN** « Déplacer de l'argent » opened on a category
- **WHEN** the owner moves an amount
- **THEN** the dialog shows the category's stored amount, as Sure's; the server still refuses more than the category gives beyond its ring-fenced subcategories, Sure's `movable_from`; a refusal answers a code per `InvalidMove` reason, shown as a notification, as Sure's flash, never as a field error.

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

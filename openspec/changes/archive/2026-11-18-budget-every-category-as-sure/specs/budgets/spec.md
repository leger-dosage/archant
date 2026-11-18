## MODIFIED Requirements

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

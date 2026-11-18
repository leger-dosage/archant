## MODIFIED Requirements

### Requirement: Category allocation

Archant SHALL give every category an envelope, copy stored allocations and carry choices, and apply the reserve rules when updating or moving an allocation.

#### Scenario: Copy category allocations

- **GIVEN** the categories of Story 32.1, without a kind
- **WHEN** a month is set up, copied or shown
- **THEN** every category has an envelope, as Sure's `Budget#sync_budget_categories`; « Copier depuis %{source_name} » copies each category's stored amount and its « Report » choice as stored, as `Budget#copy_from!`, and no longer lifts a parent to the subcategories re-parented under it since.

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

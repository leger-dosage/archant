## ADDED Requirements

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

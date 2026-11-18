## ADDED Requirements

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

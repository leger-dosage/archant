## ADDED Requirements

### Requirement: Share each account with chosen members, and personal budgets

Archant SHALL restrict access to owned and shared accounts and support personal budgets when enabled.

#### Scenario: Migrate account ownership

- **GIVEN** the schema
- **WHEN** this story ships
- **THEN** each account has an owner, its creator, as Sure's `Account#assign_default_owner`, and `account_shares` holds one row per account and member with `permission` `full_control`, `read_write` or `read_only` and `include_in_finances`, as `account_share.rb`; a migration gives every account to the first administrator, shared as `Family#auto_share_existing_accounts_with` shares.

#### Scenario: Manage shares as the owner

- **GIVEN** an account's « Partage de compte »
- **WHEN** its owner shares it
- **THEN** each member is listed with « Contrôle total », « Peut annoter » or « Lecture seule » (`account_sharings/fr.yml`); only the owner saves, as `account_sharings_controller.rb#update`, and a member it is shared with toggles « Inclure dans mes budgets et rapports ».

#### Scenario: Apply account permissions

- **GIVEN** a member
- **WHEN** they read or write
- **THEN** they reach only accounts they own or that are shared with them, as `Account.accessible_by`; `read_write` only annotates; `full_control` edits; new accounts follow « Partage par défaut pour les nouveaux comptes ».

#### Scenario: Open a personal or shared budget

- **GIVEN** « Budgets personnels » on in the preferences
- **WHEN** a member opens their budget
- **THEN** it counts the accounts they own, as `budget.rb:173`; « Budget commun » keeps the shared one; « Partage de budget » grants « Lecture seule » or « Peut modifier », as `budget_share.rb`.

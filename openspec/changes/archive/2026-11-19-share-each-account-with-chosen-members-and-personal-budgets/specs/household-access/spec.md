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

## MODIFIED Requirements

### Requirement: Invitation-only membership

Archant SHALL let administrators invite an administrator, member or guest. Upgrades SHALL preserve existing viewer accounts and invitations as guests. Guests SHALL have read-only access to data within their grants and household writes SHALL respect the administrator-only exceptions.

#### Scenario: Migrate viewer roles

- **GIVEN** `USER_ROLES` in `packages/data/user-roles.ts`
- **WHEN** this story ships
- **THEN** it holds `admin`, `member` and `guest`, as Sure's `User` enum without `super_admin`; a migration turns every `viewer` into `guest`, invitations included.

#### Scenario: Apply member permissions

- **GIVEN** a member
- **WHEN** they write
- **THEN** the server lets them modify ordinary ledger data, rules and budgets. Account writes follow ownership and share permissions.

#### Scenario: Refuse a household administration action

- **GIVEN** a member or guest
- **WHEN** they manage bank connections or their settings, change investment price settings or trigger a price refresh, manage members or invitations, change household settings, reset financial data, export the household archive, or manage assistant consent
- **THEN** the server refuses the action. The administrator-only reads for these functions stay restricted. A member who can edit a transaction or a trade can use the rule suggestion and security lookup for that operation.

#### Scenario: Refuse guest writes

- **GIVEN** a guest
- **WHEN** they send a household write
- **THEN** the server refuses the write before the route runs, as Sure does for guests, and the interface hides controls that change household data.

#### Scenario: Invite by role

- **GIVEN** « Réglages › Membres »
- **WHEN** the administrator invites or changes a role
- **THEN** the choices are « Administrateur », « Membre » and « Invité ». The server still refuses changing one's own role, self-removal and removing or demoting the last administrator.

#### Scenario: Demote an administrator

- **WHEN** an administrator becomes a member or guest
- **THEN** their next request uses the new role, their pending invitations are cancelled, and their assistant consents and tokens are revoked. A later promotion does not restore them.

#### Scenario: Accepting a valid invitation

- **WHEN** the recipient completes sign-up through the invitation
- **THEN** they join the household in the administrator, member or guest role assigned by the invitation.

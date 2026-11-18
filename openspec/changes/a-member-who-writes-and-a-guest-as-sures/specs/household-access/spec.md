## MODIFIED Requirements

### Requirement: Invitation-only membership

Archant SHALL let administrators invite an administrator, member or guest. Upgrades SHALL preserve existing viewer accounts and invitations as guests. Guests SHALL have read-only access to household data and household writes SHALL respect the administrator-only exceptions.

#### Scenario: Migrate viewer roles

- **GIVEN** `USER_ROLES` in `packages/data/user-roles.ts`
- **WHEN** this story ships
- **THEN** it holds `admin`, `member` and `guest`, as Sure's `User` enum without `super_admin`; a migration turns every `viewer` into `guest`, invitations included.

#### Scenario: Apply member permissions

- **GIVEN** a member
- **WHEN** they write
- **THEN** the server accepts every write an administrator makes, except what Sure keeps to `admin`: bank connections (`require_admin!` on `enable_banking_items_controller.rb`), invitations and members, the household's preferences (`users_controller.rb:116`) and the export (`family_exports_controller.rb:64`); an assistant's consent stays an administrator's; until Story 36.4 brings ownership, a member writes to every account.

#### Scenario: Refuse guest writes

- **GIVEN** a guest
- **WHEN** they send a household write
- **THEN** the server refuses it, as `viewerReadOnly` refuses a viewer today and Sure's `require_non_guest!` refuses a guest; the interface hides controls that write to household data.

#### Scenario: Invite by role

- **GIVEN** « Réglages › Membres »
- **WHEN** the administrator invites or changes a role
- **THEN** the choices are Sure's « Administrateur », « Membre » and « Invité » (`invitations/fr.yml`), and the last-administrator guard holds.

#### Scenario: Accepting a valid invitation

- **WHEN** the recipient completes sign-up through the invitation
- **THEN** they join the household in the administrator, member or guest role assigned by the invitation.

### Requirement: Viewer access

Archant SHALL grant guests read access while refusing household writes and administrator-only reads at the server. Guests SHALL be able to manage their own name, password and two-factor authentication.

#### Scenario: Refusing a viewer write

- **WHEN** a guest sends a financial mutation directly to the server
- **THEN** the server refuses it and no financial state changes.

#### Scenario: Managing a viewer's personal account

- **WHEN** a guest changes their name, password or two-factor authentication through their own account settings
- **THEN** the server applies the change subject to the same personal account checks as for an administrator.

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
- **THEN** the server lets them modify ordinary ledger data, rules and budgets. Until account sharing is introduced, they can write to every account.

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

### Requirement: Viewer access

Archant SHALL grant guests read access while refusing household writes and administrator-only reads at the server. Guests SHALL be able to manage their own name, password and two-factor authentication.

#### Scenario: Refusing a viewer write

- **WHEN** a guest sends a financial mutation directly to the server
- **THEN** the server refuses it and no financial state changes.

#### Scenario: Managing a viewer's personal account

- **WHEN** a guest changes their name, password or two-factor authentication through their own account settings
- **THEN** the server applies the change subject to the same personal account checks as for an administrator.

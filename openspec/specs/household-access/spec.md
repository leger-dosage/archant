# household-access

## Purpose

Household invitations and administrator or viewer permissions.

## Requirements

### Requirement: Invitation-only membership

An administrator SHALL be able to invite another member using a link for an administrator or viewer role.

#### Scenario: Accepting a valid invitation

- **WHEN** the recipient completes sign-up through the invitation
- **THEN** they join the household in the role assigned by the invitation.

### Requirement: Viewer access

Archant SHALL expose household data to viewers through permitted reads and refuse household writes and administrator-only reads at the server. Viewers SHALL be able to manage their own name, password and two-factor authentication.

#### Scenario: Refusing a viewer write

- **WHEN** a viewer sends a financial mutation directly to the server
- **THEN** the server refuses it and no financial state changes.

#### Scenario: Managing a viewer's personal account

- **WHEN** a viewer changes their name, password or two-factor authentication through their own account settings
- **THEN** the server applies the change subject to the same personal account checks as for an administrator.

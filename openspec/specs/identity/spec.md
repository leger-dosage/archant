# identity

## Purpose

Initial setup, sign-in, passwords and two-factor authentication.

## Requirements

### Requirement: Administrator setup

Archant SHALL create its first administrator through one-time setup protected by a setup token.

#### Scenario: Starting with no users

- **WHEN** a visitor submits the correct setup token and valid administrator details
- **THEN** the first administrator is created and setup closes.

### Requirement: Password and session management

Archant SHALL support sign-in, sign-out, password change and administrator password reset from the server terminal.

#### Scenario: Changing a password

- **WHEN** a signed-in member changes their password using their current password
- **THEN** existing sessions are revoked and the member signs in again with the new password.

### Requirement: Two-factor sign-in

Archant SHALL require a second factor for accounts with two-factor authentication enabled and prevent reuse of a time-based code.

#### Scenario: Reusing a time-based code

- **WHEN** a successful sign-in already consumed the code
- **THEN** another sign-in cannot use that same code.

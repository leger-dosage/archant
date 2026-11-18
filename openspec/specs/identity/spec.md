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

### Requirement: Two-factor backup codes as Sure's

Archant SHALL issue eight single-use backup codes on new two-factor enrolments, keep unused codes from existing enrolments valid, and require the current password to disable two-factor authentication.

#### Scenario: Generate eight backup codes

- **GIVEN** two-factor being turned on
- **WHEN** the codes are generated
- **THEN** Better Auth's `twoFactor` plugin issues eight 16-character hexadecimal codes, matching Sure's [`generate_backup_codes`](https://github.com/we-promise/sure/blob/655f65f8cbbe57c3dd9107e3ae07fa9b359e500f/app/models/user.rb#L1112-L1114). Each code is accepted once.

#### Scenario: Replace codes by re-enabling two-factor authentication

- **GIVEN** « Sécurité »
- **WHEN** two-factor is on
- **THEN** regeneration is unavailable in the interface and at the authentication endpoint. Disabling and re-enrolling invalidates the previous codes and issues a new set.

#### Scenario: Require a password to disable two-factor authentication

- **GIVEN** turning two-factor off
- **WHEN** a member does it
- **THEN** the current password is required, as in Sure's `mfa_controller.rb#disable`. An invalid password leaves the existing enrolment intact.

#### Scenario: Use a backup code issued before the upgrade

- **GIVEN** an unused code from an enrolment made before this change
- **WHEN** the member completes sign-in with that code after upgrading
- **THEN** sign-in succeeds and the code is consumed once.

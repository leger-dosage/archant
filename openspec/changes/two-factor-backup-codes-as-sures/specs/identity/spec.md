## ADDED Requirements

### Requirement: Two-factor backup codes as Sure's

Archant SHALL issue eight single-use backup codes when enabling two-factor authentication.

#### Scenario: Generate eight backup codes

- **GIVEN** two-factor being turned on
- **WHEN** the codes are generated
- **THEN** there are 8, each 16 hexadecimal characters, as Sure's `MFA_BACKUP_CODE_COUNT` and `SecureRandom.hex(8)` in `user.rb:893-895`, through Better Auth's `twoFactor` backup code options; each is accepted once, as today.

#### Scenario: Replace codes by re-enabling two-factor authentication

- **GIVEN** « Sécurité »
- **WHEN** two-factor is on
- **THEN** there is no control to regenerate the codes, as Sure has none; a member who needs new codes turns two-factor off and on again.

#### Scenario: Require a password to disable two-factor authentication

- **GIVEN** turning two-factor off
- **WHEN** a member does it
- **THEN** the password is still asked: a security departure from Sure's `mfa_controller.rb#disable`, which the parity page cites.

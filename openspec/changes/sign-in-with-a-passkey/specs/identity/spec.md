## ADDED Requirements

### Requirement: Sign in with a passkey

Archant SHALL allow members with two-factor authentication enabled to register passkeys and use them according to the configured sign-in mode.

#### Scenario: Manage a passkey

- **GIVEN** « Sécurité » with two-factor on
- **WHEN** a member adds a key under « Clés d'accès et clés de sécurité »
- **THEN** Better Auth's passkey plugin stores it with its name (« Nom de la clé »), date added and last use, as Sure's `webauthn_credentials`; without two-factor the control is refused, as `ensure_mfa_enabled`; « Supprimer » removes a key after a confirmation.

#### Scenario: Use a passkey to sign in

- **GIVEN** the sign-in page
- **WHEN** a member chooses « Se connecter avec une clé d'accès »
- **THEN** a discoverable passkey with user verification required signs them in without password or TOTP, as `passkey_sessions_controller.rb`, while `AUTH_PASSKEY_LOGIN_ENABLED` is true; set to false, a passkey serves only as the second factor at the code step.

#### Scenario: Label the controls

- **GIVEN** the labels
- **WHEN** Sure's `fr.yml` translates « passkey » as « mot de passe »
- **THEN** Archant writes « clé d'accès », as Sure's `sessions/fr.yml` does: French text a French user expects.

## MODIFIED Requirements

### Requirement: Two-factor sign-in

When a member with two-factor authentication enabled signs in with a password, Archant SHALL require a second factor. If full passkey sign-in is enabled, a passkey with user verification SHALL satisfy the sign-in on its own. Archant SHALL prevent reuse of a time-based code.

#### Scenario: Reusing a time-based code

- **WHEN** a successful sign-in already consumed the code
- **THEN** another sign-in cannot use that same code.

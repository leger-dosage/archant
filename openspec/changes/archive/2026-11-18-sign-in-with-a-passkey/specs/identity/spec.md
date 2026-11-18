## ADDED Requirements

### Requirement: Sign in with a passkey

Archant SHALL allow members with two-factor authentication enabled to register passkeys and use them according to the configured sign-in mode.

#### Scenario: Manage a passkey

- **GIVEN** « Sécurité » with two-factor on
- **WHEN** a member adds a key under « Clés d'accès et clés de sécurité »
- **THEN** the server requires a fresh two-factor code before saving the key, as Sure's `WebauthnCredentialsController` does. Registration consumes the code once on success. The member sees the key's name (« Nom de la clé »), date added and last use. « Supprimer » removes their key after confirmation. Without two-factor authentication the server refuses registration.

#### Scenario: Disable two-factor authentication with a key enrolled

- **WHEN** a member disables two-factor authentication or the administrator uses the terminal reset that disables it
- **THEN** the member's passkeys are revoked and cannot be used after re-enrolment.

#### Scenario: Use a passkey to sign in

- **GIVEN** the sign-in page
- **WHEN** a member chooses « Se connecter avec une clé d'accès »
- **THEN** while `AUTH_PASSKEY_LOGIN_ENABLED` is true, a discoverable passkey with user verification signs them in without password or TOTP. While it is false, the server refuses standalone passkey verification and accepts a passkey only as the second factor for its owner's pending sign-in.

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

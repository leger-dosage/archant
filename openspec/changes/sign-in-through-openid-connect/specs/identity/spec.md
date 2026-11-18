## ADDED Requirements

### Requirement: Sign in through OpenID Connect

Archant SHALL support OpenID Connect sign-in, linking and invitation-only account creation under the configured policy.

#### Scenario: Configure the identity provider

- **GIVEN** `.env.example`
- **WHEN** this story ships
- **THEN** it lists Sure's `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_REDIRECT_URI`, `AUTH_LOCAL_LOGIN_ENABLED`, `AUTH_LOCAL_ADMIN_OVERRIDE_ENABLED`, `AUTH_JIT_MODE` and `ALLOWED_OIDC_DOMAINS` (`config/auth.yml`), read through Better Auth's generic OAuth plugin; the client secret is never logged.

#### Scenario: Sign in or link an identity

- **GIVEN** the sign-in page with a provider set
- **WHEN** a member chooses « Se connecter avec OpenID Connect »
- **THEN** a known identity signs in; a new one links an existing user after their password, as `oidc_accounts_controller.rb#create_link`, or creates a user only through a pending invitation, since one instance is one household; `AUTH_JIT_MODE=link_only` and `ALLOWED_OIDC_DOMAINS` restrict creation as `AuthConfig` does.

#### Scenario: Apply the local sign-in policy

- **GIVEN** `AUTH_LOCAL_LOGIN_ENABLED=false`
- **WHEN** someone signs in with a password
- **THEN** it is refused, unless `AUTH_LOCAL_ADMIN_OVERRIDE_ENABLED` lets an administrator through, and a user without a password cannot reset one, as `password_resets_controller.rb`.

#### Scenario: Record sign-in events

- **GIVEN** each login, failure, link, unlink and creation
- **WHEN** it happens
- **THEN** it is recorded as Sure's `SsoAuditLog` `EVENT_TYPES`, without a token; AD-13 changes with this story; `docs/sure-parity.md` « OpenID Connect single sign-on » reads Parity.

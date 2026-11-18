## ADDED Requirements

### Requirement: Reset a forgotten password by e-mail

Archant SHALL let a member request a one-time password-reset link by email when mail delivery is configured.

#### Scenario: Configure email delivery

- **GIVEN** `.env.example`
- **WHEN** this story ships
- **THEN** it lists Sure's `SMTP_ADDRESS`, `SMTP_PORT` (465), `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_TLS_ENABLED`, `SMTP_TLS_SKIP_VERIFY` and `EMAIL_SENDER`, validated by `validateEnv`, with a comment saying that without `SMTP_ADDRESS` no mail leaves and `pnpm api reset-password` stays the way back; `SMTP_PASSWORD` is never logged.

#### Scenario: Request a reset without exposing membership

- **GIVEN** the sign-in page
- **WHEN** a member follows « Mot de passe oublié ? » and submits an address
- **THEN** the page answers « Veuillez vérifier votre boîte mail pour un lien de réinitialisation de votre mot de passe. » whether the address exists or not, as `password_resets_controller.rb#create`, and an existing user receives a link through Better Auth's `sendResetPassword`.

#### Scenario: Use the link once

- **GIVEN** the link
- **WHEN** it is opened within 15 minutes and a new password is set under « Réinitialiser votre mot de passe »
- **THEN** the password changes, « Votre mot de passe a été réinitialisé. » shows on the sign-in page, and the link no longer works; an expired or used link shows « Jeton invalide. ».

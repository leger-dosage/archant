## Approach

Use Better Auth's passkey plugin. Require fresh two-factor proof for enrolment, as [Sure's credentials controller](https://github.com/we-promise/sure/blob/655f65f8cbbe57c3dd9107e3ae07fa9b359e500f/app/controllers/settings/webauthn_credentials_controller.rb) does. Bind a second-factor assertion to the pending sign-in, including the user and challenge, before issuing the session. Reuse the same proof rules for both sign-in modes. Make the last successful use available in the credential list. Clear keys on both paths that disable two-factor authentication.

Better Auth's passkey plugin provides the credential model and owner-only list and delete.
Its built-in ceremony endpoints are disabled. Archant checks registration and assertions
through SimpleWebAuthn so it can claim the authenticator code and save a key atomically, and
bind a second-factor assertion to Better Auth's exact pending password challenge. The
passkey row references its two-factor enrolment with a cascading foreign key.

## Source

Story 36.7 in `docs/archive/bmad/planning-artifacts/epics.md` records the original acceptance criteria and the Sure references.

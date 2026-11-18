## 1. Implementation

- [x] 1.1 Add named passkey registration with fresh two-factor proof, credential management and revocation when two-factor authentication is disabled.
- [x] 1.2 Add standalone passkey sign-in and passkey verification for a pending two-factor sign-in. Keep the setting enforced on the server.

## 2. Verification

- [x] 2.1 AD-13 changes with this story; `.env.example` lists `WEBAUTHN_RP_ID`, `WEBAUTHN_ALLOWED_ORIGINS` and `AUTH_PASSKEY_LOGIN_ENABLED`; `docs/sure-parity.md` reads Parity for passkeys.
- [x] 2.2 Verify successful enrolment, incorrect or reused two-factor proof, revocation, both sign-in modes and a credential presented for a different pending sign-in. Use Playwright with a virtual authenticator.
- [x] 2.3 Run the repository verification commands.

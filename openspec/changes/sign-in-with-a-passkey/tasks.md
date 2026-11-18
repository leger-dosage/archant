## 1. Implementation

- [ ] 1.1 Implement the identity delta (manage a passkey, use a passkey to sign in, label the controls).

## 2. Verification

- [ ] 2.1 AD-13 changes with this story; `.env.example` lists `WEBAUTHN_RP_ID`, `WEBAUTHN_ALLOWED_ORIGINS` and `AUTH_PASSKEY_LOGIN_ENABLED`; `docs/sure-parity.md` reads Parity for passkeys.
- [ ] 2.2 Vitest covers registration, the two-factor requirement and both sign-in modes; Playwright registers and signs in with a virtual authenticator.
- [ ] 2.3 Run the repository verification commands.

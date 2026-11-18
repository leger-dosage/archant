## 1. Implementation

- [ ] 1.1 Implement the identity delta (generate eight backup codes, replace codes by re-enabling two-factor authentication, require a password to disable two-factor authentication).

## 2. Verification

- [ ] 2.1 `docs/sure-parity.md` « Two-factor codes, passkeys » reads Parity for the backup codes.
- [ ] 2.2 Vitest covers the count, the format and the single use of each code; Playwright turns two-factor on, sees eight codes and signs in with one.
- [ ] 2.3 Run the repository verification commands.

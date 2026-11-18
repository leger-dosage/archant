## 1. Implementation

- [x] 1.1 Configure the Better Auth generator for eight hexadecimal codes and keep existing codes usable. Remove the regeneration control and disable the endpoint. Preserve password verification on disable.

## 2. Verification

- [x] 2.1 `docs/sure-parity.md` « Two-factor codes, passkeys » records parity for the backup codes and password confirmation on disable.
- [x] 2.2 Verify the new format, a migrated code, single use, re-enrolment, and refusal of direct regeneration and incorrect passwords. Use Playwright to enrol and sign in with one of the eight codes.
- [x] 2.3 Run the repository verification commands.

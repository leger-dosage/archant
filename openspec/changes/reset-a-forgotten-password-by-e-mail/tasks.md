## 1. Implementation

- [x] 1.1 Configure optional mail delivery and a rate-limited reset request that gives the same response for known and unknown addresses.
- [x] 1.2 Add the reset form and token redemption. Revoke existing sessions and pending links on success and preserve two-factor enrolment.

## 2. Verification

- [x] 2.1 AD-13 changes with this story; `docs/deployment.md` explains the SMTP variables; `docs/sure-parity.md` « Password reset » reads Parity.
- [x] 2.2 Mock delivery and verify the generic response, expired and previously issued links, session revocation, and two-factor enrolment. Use Playwright to reset a password through a captured link.
- [ ] 2.3 Run the repository verification commands.

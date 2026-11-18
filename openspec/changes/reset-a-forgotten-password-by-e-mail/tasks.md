## 1. Implementation

- [ ] 1.1 Implement the identity delta (configure email delivery, request a reset without exposing membership, use the link once).

## 2. Verification

- [ ] 2.1 AD-13 changes with this story; `docs/deployment.md` explains the SMTP variables; `docs/sure-parity.md` « Password reset » reads Parity.
- [ ] 2.2 Vitest covers the request without enumeration, the expiry and the single use, with the mailer mocked; Playwright resets a password through a captured link.
- [ ] 2.3 Run the repository verification commands.

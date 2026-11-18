## 1. Implementation

- [ ] 1.1 Implement the money-and-reporting delta (choose household settings at setup, edit household preferences, use stored settings after upgrade).

## 2. Verification

- [ ] 2.1 AD-6 changes with this story; `.env.example` and `docs/deployment.md` drop `APP_TIMEZONE`; `docs/sure-parity.md` « Preferences » reads Parity for these settings.
- [ ] 2.2 Vitest covers setup, the validation and today in the stored time zone; Playwright changes each preference.
- [ ] 2.3 Run the repository verification commands.

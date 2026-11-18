## 1. Implementation

- [x] 1.1 Collect and save country, base currency and date format during setup. Backfill settings on upgrade before scheduled services start.
- [x] 1.2 Add validated administrator controls for household preferences without changing the per-user preferences flow.
- [x] 1.3 Use the saved time zone in requests and scheduled services, the saved currency in reporting, and the saved date format in the interface.

## 2. Verification

- [x] 2.1 Update AD-6 and document the legacy backfill use of `APP_TIMEZONE` in `.env.example` and `docs/deployment.md`. Update the « Preferences » row of `docs/sure-parity.md` for the settings delivered here.
- [x] 2.2 Verify setup, upgrade without overwriting saved preferences, administrator-only writes and use of the saved zone at a day boundary in requests and scheduled runs. Use Playwright to change the editable preferences and check date formatting.
- [x] 2.3 Run the repository verification commands.

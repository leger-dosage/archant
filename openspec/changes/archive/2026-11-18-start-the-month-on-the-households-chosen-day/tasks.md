## 1. Implementation

- [x] 1.1 Resolve current periods and slugs in the budget service, interface and assistant. Use the period for actuals, suggestions, carry and navigation.
- [x] 1.2 Store a unique month slug and start and end dates for each budget. Backfill calendar dates and keep each saved period when the preference changes.

## 2. Verification

- [x] 2.1 Verify dates before and after the start day, day 28 across February, slug round trips, bounds, titles, the migration and saved periods after a preference change. Use Playwright to select a budget starting on the 25th and inspect its transactions.
- [x] 2.2 Run the repository verification commands.

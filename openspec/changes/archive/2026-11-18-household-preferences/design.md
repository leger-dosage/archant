## Approach

Store settings with successful setup in the same way as the household locale. For an existing household, backfill missing settings once on startup before running jobs. Keep `APP_TIMEZONE` as a legacy source for that backfill. Read the saved value in requests and in `startSyncSchedule`, since the current `index.ts` captures the environment value at startup. Change `getReportingCurrency` and its callers to use the saved base currency. Keep personal preferences separate from household writes.

Use the formats and country-based suggestions in Sure's [`Family`](https://github.com/we-promise/sure/blob/655f65f8cbbe57c3dd9107e3ae07fa9b359e500f/app/models/family.rb). The design still uses Archant's currency exclusion rule for cross-account totals. The month start day is stored here and applied by `start-the-month-on-the-households-chosen-day`.

## Source

Story 36.6 in `docs/archive/bmad/planning-artifacts/epics.md` records the original acceptance criteria and the Sure references.

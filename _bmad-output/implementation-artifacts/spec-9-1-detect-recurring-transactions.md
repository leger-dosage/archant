---
title: 'Story 9.1: Detect recurring transactions'
type: 'feature'
created: '2026-09-24'
status: 'done'
baseline_commit: '10c68f5a69a7d51bccf1cc81ab24d2ddbb9acc5c'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-9-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Subscriptions and regular bills sit in the history unnoticed; the user would have to list them by hand (FR40).

**Approach:** Port Sure's `RecurringTransaction::Identifier` as a pure function in `domain/recurring.ts`, store its patterns in a new `recurring_transactions` table, and run it after every confirmed import and from `POST /api/recurring/detect`.

## Boundaries & Constraints

**Always:**
- Candidates: every `transaction` entry dated on or after `addMonths(today, -3)`, `today` in `deps.timeZone`, whose `direction()` is not `"transfer"`. Excluded rows count, as in Sure. A loan payment or investment contribution outflow counts, since `direction()` calls it an expense.
- Group key: account, then `merchant_id` when set, else `normalizeLabel(label)`, then the signed amount in minor units, exactly.
- A group becomes a pattern when it has at least 3 rows (Sure's `entries.size < 3`), its latest row is on or after `addDays(today, -45)`, and its days of month cluster.
- Days are compared on Sure's 31-day circle: `distance(a, b) = min(|a-b|, 31-|a-b|)`. The expected day is Sure's circular median (`calculate_expected_day`: rotation of least span, median, even count averaged and rounded). A group clusters when every pair of its days is within 5 days of each other.
- `next_expected_date`: the month after the latest row, on the expected day, clamped to that month's last day.
- `recurring_transactions` (migration `0024`): `id`, `account_id` FK cascade, `merchant_id` nullable FK cascade, `label_key` nullable, `label` (latest raw label, for display), `amount`, `currency`, `expected_day_of_month` 1–31, `last_occurrence_date`, `next_expected_date`, `occurrence_count`, `created_at`, `updated_at`. Check: exactly one of `merchant_id`, `label_key` is set. Partial unique indexes on `(account_id, merchant_id, amount)` and `(account_id, label_key, amount)`.
- Detection writes in one `{ behavior: "immediate" }` transaction: a detected pattern with an existing row updates its day, dates, count and label; a new one inserts. A stored row no longer detected stays as it is.
- After `confirmImport` commits, detection runs; a failure logs `{ importId, code }` at error level and the import still answers 200.
- `POST /api/recurring/detect` answers `200 { data: { detected } }`, the number of patterns found.

**Never:** no write to `entries`, `transactions` or `balances`; no link from a recurring row to an entry; no status, confirmation, dismissal, manual item or inactive transition (Story 9.2); no interface; no detection after a revert or a manual edit; no background job; no amount or label in a log.

## I/O & Edge-Case Matrix

| Scenario | Input / State (today 2026-09-21) | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Monthly bill | Netflix merchant, `-1399` on 07-05, 08-05, 09-05 | One row: day 5, count 3, last 09-05, next 10-05 | — |
| Two rows only | `-1399` on 08-05, 09-05 | No row | — |
| Stale | Three rows, latest 08-01 | No row (older than 45 days) | — |
| Month end | Rows on 06-30, 07-31, 08-31 | Day 31, next 09-30 | — |
| Wrap | Days 30, 1, 2 | Clusters, expected day 1 | — |
| Spread | Days 5, 15, 15 | No row (Sure's standard deviation would accept it) | — |
| Label variants | « PRLV EDF » and « prlv  édf », no merchant | One group, `label_key` `prlv edf` | — |
| Other amount | Same merchant at `-1399` and `-1799` | Two rows | — |
| Transfer | Three matched transfer sides | No row | — |
| Rerun | Same data twice | Same row updated, no duplicate | — |

</frozen-after-approval>

## Code Map

- `packages/api/src/services/ledger.ts` -- `ruleCandidates(db, from)` 1178 already returns account, date, amount, currency, label, merchant and transfer kind for every transaction from a date: reuse it, do not write a second loader or transfer join.
- `packages/api/src/domain/cash-flow.ts` -- `direction()` 28, the one transfer test.
- `packages/api/src/domain/normalize-label.ts` -- `normalizeLabel` 6, whose comment already names this use.
- `packages/api/src/domain/dates.ts` -- `today` 11, `addDays` 25, `addMonths` 57 (clamps month ends), private `daysInMonth` 42: export it or add a `withDay(date, day)` helper beside `addMonths`.
- `packages/api/src/services/imports.ts` -- `confirmImport` 370: call detection after the transaction resolves, before the `import confirmed` log; follow the `revertImport` error log at 506, code only.
- `packages/api/src/routes/rules.ts` 39 and `app.ts` `createApi` 53 -- model for a POST action route and its mount (`.route("/recurring", …)`).
- `packages/data/schema/import-mappings.ts` 15 (cascade FK on accounts), `schema/imports.ts` 72–101 and `schema/check.ts` (checks), `types.ts`, `package.json` `exports` (one entry per schema file), `migrate.spec.ts` (`migrated()` 31, one `describe` per feature). `pnpm --filter @archant/data generate --name add_recurring_transactions`.
- Cascades mean `ledger.deleteAccount` 2077 and `merchants.deleteMerchant` / `mergeMerchant` need no change; a merge drops the source merchant's rows and the next detection recreates them under the target.
- Coverage: `src/domain/**` at 100 % (`packages/api/vitest.config.ts` 15–19).

## Tasks & Acceptance

**Execution:**
- [x] `packages/data/migrate.spec.ts`, `schema/recurring-transactions.ts`, `types.ts`, `package.json`, `drizzle/0024_*` -- failing tests for the check, both unique indexes and both cascades, then schema and migration.
- [x] `packages/api/src/domain/dates.spec.ts`, `dates.ts` -- the day-of-month helper, February and leap years.
- [x] `packages/api/src/domain/recurring.spec.ts`, `recurring.ts` -- every matrix row but the rerun, plus the circular median on even counts and wraps, then `detectRecurring(candidates, today)`.
- [x] `packages/api/src/services/recurring.spec.ts`, `services/recurring.ts` -- `detectRecurring(deps)`: load, detect, upsert; rerun, update of an existing row, row kept when no longer detected, 45-day and 3-month bounds against a fake clock.
- [x] `packages/api/src/services/imports.ts`, `routes/recurring.ts`, `app.ts` -- post-import call and the route.
- [x] `packages/api/src/app.spec.ts` -- `describe("POST /api/recurring/detect")` and, under the import confirm block, detection after a confirm and a 200 when detection throws.

**Acceptance Criteria:**
- Given three monthly Netflix rows imported from an OFX file, when the import is confirmed, then `recurring_transactions` holds one row with day 5, amount `-1399`, currency `EUR`, last date and count 3.
- Given the same rows entered by hand, when `POST /api/recurring/detect` runs, then it answers `{ data: { detected: 1 } }` and the row exists.
- Given detection throws, when an import is confirmed, then the import answers 200 and one error log carries the import id and no amount.

## Implementation Notes

- `domain/recurring.ts` exports `dayDistance`, `expectedDay`, `LOOKBACK_MONTHS` and `detectRecurring(candidates, today)`; the service loads from `addMonths(today, -LOOKBACK_MONTHS)` so the window has one source. `RecurringCandidate` is a structural subset of `RuleCandidate`, so `ruleCandidates` feeds it unchanged.
- `domain/dates.ts` gains `withDay(date, day)`, clamped to the month's last day; `daysInMonth` stays private.
- The schema adds `recurring_transactions_merchant`, a plain index on `merchant_id`, so the merchant cascade does not scan; the partial unique indexes cannot serve it.
- `confirmImport` calls the private `detectAfterImport` after its transaction resolves and before the `import confirmed` log; the failure log carries `{ importId, code }`, `INTERNAL_ERROR` for anything but an `AppError`.
- `services/recurring.spec.ts` migrates a fresh database per test: copying a shared migrated file produced an empty one.

## Spec Change Log

## Review Triage Log

| # | Source | Finding | Verdict | Route / evidence |
|---|--------|---------|---------|------------------|
| 1 | blind | Next date lands before the real due date when the latest row came early across a month end (07-01, 08-02, 08-31 → 09-01) | medium | defer: Sure's own rule, frozen in the intent; shown only by 9.2, logged in `deferred-work.md` |
| 2 | blind | Three identical purchases within one month form a monthly pattern | low | rejected: Sure accepts them too; no month-distinct rule in the intent |
| 3 | blind | `occurrenceCount` counts same-day duplicates | low | rejected: Sure counts entries, not months |
| 4 | blind, verification-gap | A label-keyed pattern regrouped under a merchant later leaves its twin behind | medium | defer: undetected rows stay by design; 9.2's inactive transition must cover it |
| 5 | blind | A reverted import leaves stored counts and dates computed on deleted rows | medium | defer: same root as 4, logged together |
| 6 | blind | Spec status and sprint status differ | false | statuses move at their own workflow steps |
| 7 | blind | Service hard-codes three months beside `LOOKBACK_MONTHS` | low | patch: export and reuse the constant |
| 8 | blind | Nothing forces Epic 10's sync to call detection | low | rejected: `epic-9-context.md` states it for Epic 10 |
| 9 | blind, verification-gap | The merchant path is never exercised against the database | medium | patch: service test with two merchants, detected twice |
| 10 | blind | The import log could carry `detected` | low | rejected: not asked, no reader |
| 11 | blind | No full index on `account_id` for the account cascade | low | rejected: tens of rows per household; a scan on account deletion costs nothing |
| 12 | edge | A future-dated row becomes the latest occurrence | low | rejected: Sure has no upper bound either; hand-entered future rows are rare |
| 13 | edge | Two currencies on one account merge into one pattern | false | AD-6: an entry's currency always equals its account's, the ledger refuses anything else |
| 14 | edge | Unique indexes and updates ignore currency | false | same as 13 |
| 15 | edge | A label normalising to an empty string groups unrelated rows | low | rejected: labels are required at every entry path; no blank label reaches the ledger in practice |
| 16 | verification-gap | « Excluded rows count » is untested | medium | patch: service test with one excluded row |

## Design Notes

Taken from Sure rather than asked: 3 occurrences, three months, 45 days, exact signed amount, merchant before name, per-account grouping, circular median, next date from the latest row, excluded rows included, rows never deleted by detection. Departures: the label is normalised, as the architecture binds `normalize-label.ts` to this use; clustering checks the pairwise spread instead of Sure's standard deviation of distances to the median, which accepts days 5, 15 and 15 against its own « within ~5 days » comment; transfers follow `direction()`, so a loan payment counts where Sure skips every transfer kind; detection runs after each import rather than after a debounced sync job, since one household's three months load in one query.

No Playwright test: this story shows nothing. The page and its « Détecter » button arrive with 9.2.

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test && pnpm test:e2e` -- expected: all pass, no tracked file modified afterwards.

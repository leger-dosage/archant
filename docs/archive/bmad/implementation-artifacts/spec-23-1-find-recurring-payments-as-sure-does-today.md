---
title: 'Story 23.1: Find recurring payments as Sure does today'
type: 'feature'
created: '2026-10-05'
status: 'done'
baseline_commit: '41574e705ddb8457426c30bd17af9df169a02b48'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-23-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Detection groups by exact amount, so a bill whose amount moves by a few cents or rises in price is missed or listed twice, and its statuses are not Sure's.

**Approach:** Port Sure's identifier at `14638a701` (`identifier.rb`, `recurring_transaction.rb`, `cleaner.rb`) into `domain/recurring/`, rename the statuses to Sure's, and give `/recurring` Sure's suggestions strip and actions. Story 23.1 of `epics.md` is the acceptance contract; this spec adds what reading the code and Sure settled. The owner authorised every decision below; each is an assumption the pull request lists.

## Boundaries & Constraints

**Always:**
- Migration `0055` rebuilds `recurring_transactions` (`__new_` rebuild, as `0025`): `status` mapped with `CASE` (`detected`→`suggested`, `confirmed`→`active`, `dismissed`→`ended`, `inactive` kept), default `suggested`; nullable integers `expected_amount_min`, `expected_amount_max`, `expected_amount_avg`; `dedup_scope` text not null default `''`; the two partial unique indexes become `(account_id, merchant_id|label_key, amount, currency, dedup_scope)`. A series on an `investment` account becomes `ended`, as Sure's #3565 migration. `RECURRING_STATUSES` = `suggested`, `active`, `inactive`, `ended`.
- Candidates: three calendar months, `direction()` not `transfer` (a loan payment or contribution outflow stays, Spec 9.1), no `investment` account, no split parent. Group by account, merchant or else normalised label, currency. Within a group sort by the negated amount ascending; a row joins the last cluster when `1000 × |amount × n − sum| ≤ 75 × |sum|` over that cluster's `n` rows, else starts one.
- Pattern: at least 3 rows, latest within 45 days, every day within 2 of the expected day. Expected day is Sure's `calculate_expected_day`: rotate the 0-based days by the lowest pivot 0–30 giving the smallest span, take the median (even count: half rounded away from zero), map back. Distance is `min(|a−b|, 31−|a−b|)`. Amount is the latest row's; band min and max are the signed minimum and maximum; avg is `sum / n` rounded half away from zero, as Sure's `BigDecimal#round`.
- Claiming: among the stored series of the same account, key and currency, every status and manual included, the one whose amount passes the 7.5 % test against the pattern's mean and lies nearest wins. Ended or manual: untouched. Otherwise last date, count, band, day and next date are written; amount and status never. Unclaimed: a `suggested` series, `dedup_scope` = the avg as a decimal integer string when its key already has any series, one written earlier in the run included, patterns being written in ascending amount order; else `''`.
- Manual pass: an `active` manual series takes count, last date and band from its account's rows of six months with its key and currency, amount between half and twice its own inclusive, day within 2 of its expected day. Story 11.8's re-key and refresh keep their shape; their amount test becomes the same half-to-twice band and their day test the same ±2.
- Cleaner, at each detection and from `POST /api/recurring/cleanup` (answers `{ data: { inactive } }`): an `active` series becomes `inactive` when its last date is before the earlier of today minus 2 months (6 for manual) and today minus 61 days (two monthly cycles, `ceil(2 × 365.25 / 12)`), and none of its rows since passes the manual pass's tests. A suggestion never becomes inactive; one whose rows all left its window is deleted.
- Transitions, `PATCH /api/recurring/:id` `{ status }`: `active` from `suggested`, `inactive` or `ended`; `inactive` from `active`; `ended` from `suggested`; else `VALIDATION_ERROR` on `status`. `DELETE /api/recurring/:id` deletes a manual series and ends a detected one. « Ajouter aux récurrences » writes `active`, `manual`. Detection never recreates an ended series.
- `/recurring`: « Nouvelles factures possibles » with the suggestions' count, each row the name, amount, « Vue 3 fois » (`vue une fois` for 1) and « Ajouter la facture », « Ce n'est pas une facture ». The list shows active and inactive series, badges « Active » and « Inactive », menu « Mettre en pause » or « Reprendre », « Supprimer » with a confirmation; an amount whose min differs from its max reads « varie de 571,22 € à 571,36 € » (magnitudes ascending). « Nettoyer les obsolètes » beside « Détecter », administrator only. Ended series are hidden.
- Export: `status` written as is; `SURE_RECURRING_STATUSES` and `archant.status` go; `expected_amount_min/max/avg` written with `sureAmount`, `dedup_scope` as stored.

**Never:** no schedule, bill field, occurrence or history backfill (23.2, 23.3); no `paused`; no deletion of an old inactive series; no change to when detection runs.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected |
|---|---|---|
| Mortgage | −571,29, −571,36, −571,22 on 7 Jul, 7 Aug, 8 Sep; run 15 Sep | one `suggested`, amount −571,22, band −571,36 to −571,22, day 7 |
| Mortgage drift | same on 6 Jul, 10 Aug, 7 Sep, 5 Oct; run 6 Oct | none (10 is 3 from 7) |
| Price rise | 9,99, 9,99, 10,49 monthly | one series, amount 10,49 |
| Tiers | 10, 20, 40 € three months each, one merchant | three series; those written after the first carry `dedup_scope` |
| Tolerance | mean 1000, row 1075 / 1076 | joins / new cluster |
| Ended claim | ended series, pattern within 7.5 % | still ended, untouched |
| Bad move | `PATCH` `inactive` on a suggestion | `400 VALIDATION_ERROR` |

</frozen-after-approval>

## Code Map

- `packages/data/schema/recurring-transactions.ts` -- statuses :12, checks :48-56, indexes :57-60; `pnpm data generate`, then hand-edit the `INSERT … SELECT` with a `CASE` and a why-comment, as `drizzle/0025`. `data/migrate.spec.ts:1227` describe, `:1300` existing-rows test via `migratedBefore`.
- `packages/api/src/domain/recurring.ts` → `domain/recurring/identifier.ts` (clustering, `expectedDay`, `dayDistance`, patterns, claim choice, band and day tests) and `domain/recurring/series.ts` (`nextExpectedDate`, `nextDateFrom`, cleaner threshold, `rekey`, `occurrencesOf`, `refreshSeries`, `currentNextDate`). Drop `MAX_DAY_SPREAD`, `clusters`, `isStale`. Specs move alongside.
- `packages/api/src/services/recurring.ts` → `services/recurring/series.ts`: `detectRecurring` :115 keeps its single immediate transaction; claims replace the key match :164-196; cleaner replaces the stale pass :232-246; `ALLOWED_FROM` :75; `listRecurring` :312 excludes `ended`; new `deleteRecurring`, `cleanupRecurring`; `recurringEntryIds` :415 `ne ended`. Candidates from `ruleCandidates` (`ledger/rule-plans.ts:233`) plus an account-type filter. Update importers (`imports.ts:459`, `sync.ts:288`, `transactions.ts`, `export.ts`).
- `packages/api/src/routes/recurring.ts`, `schemas/recurring.ts` -- PATCH enum, `DELETE /:id`, `POST /cleanup`.
- `packages/api/src/mcp/recurring.ts:33`, `schemas/assistants.ts:56` -- describe `suggested` (found by Archant, awaiting the owner), `active`, `inactive` (paused or retired); `current` = suggested or active.
- `services/export.ts:94-99,729-748`, `ledger/export.ts:81-95` -- new columns in `EXPORTED_COLUMNS`.
- `packages/app/src/routes/_authed.recurring.tsx`, `hooks/useRecurring.ts`, `components/StatusBadge.tsx:46-53`, `locales/fr.json:1366-1406` (`recurring.*`, description rewritten), `components/TransactionLinks.tsx:271`.
- `testing/app.ts:404-418`, `mcp/server.spec.ts:1085,1151`, `services/export.spec.ts:1296`, `ledger/export.spec.ts:467`, `routes/imports.spec.ts`, `services/sync.spec.ts`, e2e `recurring.spec.ts`, `viewer.spec.ts`, `proportions.spec.ts`, `brand.spec.ts` -- status literals and badge keys.
- `docs/sure-parity.md:188-221` rows Grouping, Day clustering, Transfers and accounts, Status, Claiming and tiers, Inactive, Manual pass; `docs/architecture.md` AD-24 unchanged.

## Tasks & Acceptance

**Execution:**
- [x] `packages/data/migrate.spec.ts` -- existing rows mapped per status, investment series ended, new unique indexes, default -- then schema and `0055`.
- [x] `domain/recurring/identifier.spec.ts` -- the matrix, circular day across 30/31/1, pivot ties, even-count rounding, latest within 45 days, branch coverage -- then `identifier.ts`.
- [x] `domain/recurring/series.spec.ts` -- band and ±2 day in re-key, refresh and manual pass; cleaner thresholds at the boundary -- then `series.ts`.
- [x] `services/recurring/series.spec.ts` -- claiming (ended, manual, nearest), dedup scope, investment left out, transitions, delete manual vs detected, cleanup route -- then the service, routes, MCP, export.
- [x] `packages/app/e2e/recurring.spec.ts` -- suggestions strip, add and dismiss, pause and resume, delete, band text, cleanup -- then the page, hooks, badges, locale.
- [x] `docs/sure-parity.md` -- the rows above become parity or name the departure.

**Acceptance Criteria:**
- Given a viewer, when they open `/recurring`, then no action button shows and `viewerReadOnly` refuses `PATCH`, `DELETE` and `POST /cleanup`.
- Given a detection after an import, a revert or a sync, when it fails, then the request still succeeds and the code alone is logged.

## Implementation Notes

- QA at 1280 px: a « Vue » column pushed « Ajouter la facture » out of the suggestions card. « Vue 3 fois » now sits under the name, as Sure's `_suggested_series`, and the name column truncates.
- The exported band swaps its bounds after `sureAmount` negates them, so Sure reads `expected_amount_min ≤ expected_amount_max`.
- `toRecord` in `services/recurring/series.ts` keeps a `number` amount: it converts the raw SQLite row with `toMinorUnits`.

## Spec Change Log

## Review Triage Log

| # | Finding | Verdict | Evidence | Route |
|---|---|---|---|---|
| 1 | `docs/sure-parity.md` legend header replaced by the recurring Status row; the real Status row unchanged | high | Line 9 now holds the recurring row; line 198 still reads « Detected, confirmed, dismissed ». | patch |
| 2 | A series created in a run and claimed by a later pattern is inserted from its first snapshot | medium | `inserts` keeps the object pushed at creation while `current` gets the claim; Sure's `existing_by_identity << created` lets the later claim persist. | patch |
| 3 | « Nettoyer les obsolètes » has no end-to-end test that a series turns inactive | medium | Pre-verified gap: the e2e test makes a fresh series and accepts any toast. | patch |
| 4 | `deleteDialog.description` says detection never proposes it again, false for a manual series, which is deleted; `recurring.description` names two months only | low | Manual delete removes the row (`deleteRecurring`), so a later pattern creates a suggestion. Direct wording fix. | patch |
| 5 | An income band reads unsigned while a single income amount reads signed | low | `RecurringAmount` uses `Math.abs` for the band and `signed` for one amount. Direct fix. | patch |
| 6 | Test names in `services/recurring/series.spec.ts` keep « confirmed », « dismissed » | low | Names only; assertions use the new statuses. Direct rename. | patch |
| 7 | Two patterns may claim one series in a run | false | Sure's `nearest_within_tolerance` excludes nothing either; only the stale insert (row 2) departs from Sure. | reject |
| 8 | `detected` counts claims of manual or active series | low | Sure returns `recurring_patterns.size`; Archant only removes tombstones. By design. | reject |
| 9 | `rekey` same-day rows ignore currency | false | One currency per account (AD-6); the rows share the account. | reject |
| 10 | An ended series whose price drifts past 7.5 % comes back suggested | false | Sure's behaviour at `14638a701`: an unclaimed pattern creates a scoped suggestion. | reject |
| 11 | A claimed series keeps its old amount after a price rise | false | Spec and Sure: amount never changes on a claim; price changes are Story 23.3. | reject |
| 12 | Half-to-twice band in refresh mixes tiers of one key | low | Frozen intent: « Story 11.8's re-key and refresh … apply the same amount and day tests ». | reject |
| 13 | « Reprendre » on a stale series is undone by the next detection's cleaner | low | Frozen intent runs the cleaner at each detection. Reported to the owner. | reject |
| 14 | Migration keeps old exact-amount twins | low | Claiming takes the nearest; no data loss; fix would add merge logic. | reject |
| 15 | `dedup_scope` exported in Archant's signed minor units | low | Spec: « `dedup_scope` as stored »; Sure only reads it in its unique index. | reject |
| 16 | Inactive accounts feed detection | false | Sure's query has no account-status filter; unchanged since Spec 9.1. | reject |
| 17 | Suggestions show no account | false | Sure's `_suggested_series` shows none. | reject |
| 18 | Preflight skips avg within band; MCP status text omits `ended` | low | `listRecurring` never returns ended rows; avg is computed from the same rows. | reject |
| 19 | `addRecurringFromEntry` activates an existing series without `manual` | low | Spec 9.2's rule kept; the spec's « writes active, manual » covers a new row. | reject |
| 20 | `seriesOfTransaction` names a tier by exact amount, else the latest | maybe-false | Pre-existing (Spec 11.8); settled when Story 23.3's matcher names the occurrence. | defer |
| 21 | Money typed as a bare `number` in `identifier.ts` signatures and `seriesOfTransaction` | medium | AGENTS.md: « A bare `number` in a function signature that means money is a bug. » | patch |
| 22 | `sure-parity.md` « Next date » row still says « a confirmed or manual item » | low | Line 201; the status no longer exists. Direct wording fix. | patch |
| 23 | Day and date math outside `domain/recurring/schedule.ts` (AD-24) | false | The epic hands `schedule.ts` to Story 23.2, which replaces 23.1's monthly-only math. | reject |
| 24 | Band, next date and suggestion delete repeated across `identifier.ts`, `series.ts` and the service; `LOOKBACK_MONTHS` declared twice | low | Judgement call; each copy is short and the fix moves code Story 23.2 rewrites. | reject |
| 25 | `isKept`, `dedupScope` as a string, a comment citing Story 11.8 | low | Names predate 23.1 or mirror Sure's column. | reject |
| 26 | The suggestions table heads a column « Vue » above « Vue 3 fois » | low | Cosmetic; Sure's strip has no header. | reject |

## Design Notes

Signs: Archant stores an expense negative (AD-5); sorting by the negated amount gives Sure's cluster order, and the integer test is sign-symmetric. A band is stored signed like `amount`, so for an expense `expected_amount_min` is the largest magnitude; the interface shows magnitudes ascending.

`inactive` reads « Inactive », as Sure's French `Inactif`: one stored status cannot carry both « En pause » and « Inactive », which the epic lists side by side.

## Verification

**Commands:**
- `pnpm typecheck && pnpm lint:code && pnpm lint:format` -- expected: clean.
- `pnpm test` -- expected: green, `domain/recurring/identifier.ts` at 100 % branches.
- `pnpm test:e2e` -- expected: green.
